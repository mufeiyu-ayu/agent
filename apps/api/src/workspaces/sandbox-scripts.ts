import { MAX_READ_OBSERVATION_CHARS } from './workspace-files.js'

// 固定的执行监督代码；用户代码只在沙箱中的非特权子进程里执行，平台凭据不传入环境。
export const FILE_SCRIPT = String.raw`
import os,sys,json,base64,stat,pwd,shlex
ROOT='/workspace/project'
MAX_FILE=2097152
MAX_TOTAL=8388608
MAX_FILES=200
uid=pwd.getpwnam('user').pw_uid
gid=pwd.getpwnam('user').pw_gid
os.makedirs(ROOT,exist_ok=True)
if os.path.islink(ROOT) or os.path.realpath(ROOT)!=ROOT: raise ValueError('工作区根目录无效')
os.chown(ROOT,uid,gid)
data=json.load(open(sys.argv[1]))
def parent(path,create=False):
    parts=path.split('/')
    if not path or path.startswith('/') or any(p in ('','..','.') for p in parts): raise ValueError('文件路径无效')
    fd=os.open(ROOT,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if create:
                try:
                    os.mkdir(part,dir_fd=fd)
                    os.chown(part,uid,gid,dir_fd=fd,follow_symlinks=False)
                except FileExistsError: pass
            next_fd=os.open(part,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW,dir_fd=fd)
            os.close(fd);fd=next_fd
        return fd,parts[-1]
    except:
        os.close(fd);raise
def read(path):
    fd,name=parent(path)
    try:
        handle=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=fd)
        with os.fdopen(handle,'rb') as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode): raise ValueError('只支持普通文件')
            content=stream.read(MAX_FILE+1)
            if len(content)>MAX_FILE: raise ValueError('单个文件不能超过 2 MiB')
            return content
    finally: os.close(fd)
def write(path,content):
    if len(content)>MAX_FILE: raise ValueError('单个文件不能超过 2 MiB')
    fd,name=parent(path,True)
    temporary='.kuro-'+os.urandom(12).hex()
    try:
        try:
            info=os.stat(name,dir_fd=fd,follow_symlinks=False)
            if not stat.S_ISREG(info.st_mode): raise ValueError('只支持普通文件，不允许符号链接')
        except FileNotFoundError: pass
        handle=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=fd)
        with os.fdopen(handle,'wb') as stream:
            stream.write(content);stream.flush();os.fsync(stream.fileno());os.fchown(stream.fileno(),uid,gid)
        os.replace(temporary,name,src_dir_fd=fd,dst_dir_fd=fd)
    finally:
        try: os.unlink(temporary,dir_fd=fd)
        except FileNotFoundError: pass
        os.close(fd)
def snapshot():
    files=[];total=0
    for folder,dirs,names in os.walk(ROOT,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in ('node_modules','.git','.venv','__pycache__'))
        for d in dirs:
            if os.path.islink(os.path.join(folder,d)): raise ValueError('工作区不能包含符号链接')
        for name in sorted(names):
            path=os.path.relpath(os.path.join(folder,name),ROOT)
            content=read(path);total+=len(content)
            if total>MAX_TOTAL or len(files)>=MAX_FILES: raise ValueError('工作区最多 200 个文件、总计 8 MiB')
            files.append({'path':path,'content':base64.b64encode(content).decode()})
    return {'files':files}
try:
    action=data['action']
    if action=='snapshot': result=snapshot()
    elif action=='restore':
        for item in data['files']: write(item['path'],base64.b64decode(item['content']))
        result={'restored':len(data['files'])}
    elif action=='write':
        write(data['path'],data['content'].encode('utf-8'));result={'path':data['path'],'written':True}
    elif action=='read':
        text=read(data['path']).decode('utf-8');lines=text.splitlines()
        start=data.get('offset',1)-1;limit=data.get('limit',200)
        result={'path':data['path'],'totalLines':len(lines),'offset':start+1,'content':'','nextOffset':None}
        # 与最终 observation 共用预算；按 JSON 转义后的 Unicode 字符数扣除整行。
        # 32 字符余量覆盖 nextOffset 位数和 truncated 元数据，不把未返回的行算作已读。
        remaining=${MAX_READ_OBSERVATION_CHARS}-len(json.dumps(result,ensure_ascii=False,separators=(',',':')))-32
        selected=[];cursor=start
        for index in range(start,min(start+limit,len(lines))):
            line=str(index+1)+': '+lines[index]
            size=len(json.dumps(line,ensure_ascii=False))-2+(2 if selected else 0)
            if size>remaining:
                result['truncated']=True
                if not selected:
                    command="import json,pathlib;line=pathlib.Path("+repr(data['path'])+").read_text(encoding='utf-8').splitlines()["+str(index)+"];start=0;part=line[start:start+1000];print(json.dumps({'content':part,'nextCharOffset':start+len(part) if start+len(part)<len(line) else None},ensure_ascii=False))"
                    result['readCommand']='python3 -I -S -c '+shlex.quote(command)
                    result['hint']='当前行超过读取预算，尚未返回；用 bash 执行 readCommand，将 start 改为 nextCharOffset 逐段续读；该行读完后用 read offset='+str(index+2)+' 读取后续行。'
                break
            selected.append(line);remaining-=size;cursor=index+1
        result['content']='\n'.join(selected)
        result['nextOffset']=cursor+1 if cursor<len(lines) else None
    elif action=='edit':
        text=read(data['path']).decode('utf-8');bom='\ufeff' if text.startswith('\ufeff') else ''
        if bom: text=text[1:]
        ending='\r\n' if '\r\n' in text else '\n';original=text.replace('\r\n','\n');changes=[]
        for edit in data['edits']:
            old=edit['oldText'].replace('\r\n','\n');new=edit['newText'].replace('\r\n','\n')
            index=original.find(old)
            if not old or index<0: raise ValueError('原文未找到，请先 read 获取最新内容')
            if original.find(old,index+1)>=0: raise ValueError('原文匹配不唯一，请提供更多上下文')
            changes.append((index,index+len(old),new))
        changes.sort()
        if any(changes[i][1]>changes[i+1][0] for i in range(len(changes)-1)): raise ValueError('多个替换范围重叠')
        updated=original
        for start,end,new in reversed(changes): updated=updated[:start]+new+updated[end:]
        write(data['path'],(bom+updated.replace('\n',ending)).encode('utf-8'))
        result={'path':data['path'],'replacements':len(changes)}
    else: raise ValueError('未知文件操作')
    print(json.dumps(result,ensure_ascii=True))
except (ValueError,OSError,UnicodeError) as error:
    print(json.dumps({'error':str(error)[:400]},ensure_ascii=True))
`

export const BASH_SCRIPT = String.raw`
import os,sys,json,subprocess,selectors,time,signal,pwd,ctypes,resource
data=json.load(open(sys.argv[1]));ROOT='/workspace/project'
account=pwd.getpwnam('user')
if ctypes.CDLL(None).prctl(36,1,0,0,0)!=0: raise RuntimeError('无法启用子进程监督')
# 云端禁出网不保护本机 envd；禁止网络 socket，保留 Python/Node 所需的 Unix IPC。
# 使用模板已有的 libseccomp 处理架构与 syscall 编号，缺失或加载失败一律不执行用户命令。
seccomp=ctypes.CDLL('libseccomp.so.2')
class ArgCompare(ctypes.Structure):
    _fields_=[('arg',ctypes.c_uint),('op',ctypes.c_int),('a',ctypes.c_uint64),('b',ctypes.c_uint64)]
seccomp.seccomp_init.argtypes=[ctypes.c_uint32];seccomp.seccomp_init.restype=ctypes.c_void_p
seccomp.seccomp_syscall_resolve_name.argtypes=[ctypes.c_char_p];seccomp.seccomp_syscall_resolve_name.restype=ctypes.c_int
seccomp.seccomp_rule_add_array.argtypes=[ctypes.c_void_p,ctypes.c_uint32,ctypes.c_int,ctypes.c_uint,ctypes.POINTER(ArgCompare)]
seccomp.seccomp_load.argtypes=[ctypes.c_void_p]
seccomp.seccomp_release.argtypes=[ctypes.c_void_p]
def restrict_network():
    context=seccomp.seccomp_init(0x7fff0000)
    if not context: raise RuntimeError('无法初始化命令网络隔离')
    try:
        # SCMP_CMP_NE：只有 AF_UNIX=1 可用；同时阻断通过 io_uring 绕过 socket syscall 的路径。
        rule=ArgCompare(0,1,1,0)
        for name in (b'socket',b'socketpair',b'io_uring_setup'):
            number=seccomp.seccomp_syscall_resolve_name(name)
            count=0 if name==b'io_uring_setup' else 1
            if number<0 or seccomp.seccomp_rule_add_array(context,0x00050001,number,count,ctypes.byref(rule) if count else None)!=0:
                raise RuntimeError('无法配置命令网络隔离')
        if seccomp.seccomp_load(context)!=0: raise RuntimeError('无法启用命令网络隔离')
    finally: seccomp.seccomp_release(context)
def drop_privileges():
    resource.setrlimit(resource.RLIMIT_NPROC,(128,128))
    resource.setrlimit(resource.RLIMIT_FSIZE,(16777216,16777216))
    os.setgroups([]);os.setgid(account.pw_gid);os.setuid(account.pw_uid)
    if ctypes.CDLL(None).prctl(38,1,0,0,0)!=0: raise RuntimeError('无法启用 no_new_privs')
    restrict_network()
process=subprocess.Popen(['/bin/bash','-lc',data['command']],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,preexec_fn=drop_privileges,env={'PATH':'/usr/local/bin:/usr/bin:/bin','HOME':account.pw_dir,'LANG':'C.UTF-8','TMPDIR':'/tmp'})
selector=selectors.DefaultSelector()
for stream,name in ((process.stdout,'stdout'),(process.stderr,'stderr')):
    os.set_blocking(stream.fileno(),False);selector.register(stream,selectors.EVENT_READ,name)
output={'stdout':bytearray(),'stderr':bytearray()};truncated=False;timed_out=False
deadline=time.monotonic()+data.get('timeout',60)
def kill_group():
    try: os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError: pass
def reap_children():
    deadline=time.monotonic()+3
    while True:
        try: pid,status=os.waitpid(-1,os.WNOHANG)
        except ChildProcessError: return
        if pid: continue
        # 子孙进程退出父进程后由内核重新挂到本监督进程；直到 waitpid 返回 ECHILD 才确认清空。
        path='/proc/'+str(os.getpid())+'/task/'+str(os.getpid())+'/children'
        for child in open(path).read().split():
            try:
                os.kill(int(child),signal.SIGSTOP)
                os.kill(int(child),signal.SIGKILL)
            except ProcessLookupError: pass
        if time.monotonic()>deadline: raise RuntimeError('后台进程清理未确认')
        time.sleep(0.01)
while selector.get_map() or process.poll() is None:
    if time.monotonic()>deadline:
        timed_out=True;kill_group();break
    if process.poll() is not None:
        kill_group();reap_children()
    for key,event in selector.select(0.1):
        chunk=os.read(key.fileobj.fileno(),8192)
        if not chunk: selector.unregister(key.fileobj);continue
        buffer=output[key.data];buffer.extend(chunk)
        if len(buffer)>32768:
            buffer[:]=buffer[:16384]+buffer[-16384:];truncated=True
kill_group()
process.wait(timeout=5)
reap_children()
code=process.returncode if process.returncode>=0 else 128-process.returncode
print(json.dumps({'stdout':bytes(output['stdout']).decode('utf-8','replace'),'stderr':bytes(output['stderr']).decode('utf-8','replace'),'exitCode':code,'truncated':truncated,'timedOut':timed_out},ensure_ascii=True))
`
