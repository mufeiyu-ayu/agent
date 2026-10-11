/** 仅宿主执行；root 管理的资源树与用户源码分离，不参与 Source/Artifact 快照。 */
export const SKILL_RESOURCES_SCRIPT = String.raw`
import os,sys,json,base64,hashlib
packages=json.load(open(sys.argv[1]))
base='/opt/kuro-skills'
if os.path.lexists(base) and (os.path.islink(base) or os.stat(base).st_uid!=0):
    raise ValueError('unsafe skill root')
os.makedirs(base,mode=0o755,exist_ok=True)
for package in packages:
    import re
    if not re.fullmatch('[a-f0-9]{64}',package['fingerprint']) or not re.fullmatch('[a-z0-9]+(?:-[a-z0-9]+)*',package['name']):
        raise ValueError('invalid skill identity')
    root=base+'/'+package['fingerprint']+'/'+package['name']
    os.makedirs(root,mode=0o755,exist_ok=True)
    for file in package['files']:
        parts=file['path'].split('/')
        if any(not re.fullmatch(r'[\w.-]+',p) or p.startswith('.') for p in parts):
            raise ValueError('invalid skill path')
        target=root+'/'+file['path']
        os.makedirs(os.path.dirname(target),mode=0o755,exist_ok=True)
        content=base64.b64decode(file['content'],validate=True)
        if os.path.lexists(target):
            if os.path.islink(target) or open(target,'rb').read()!=content:
                raise ValueError('skill resource mismatch')
        else:
            fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o444)
            with os.fdopen(fd,'wb') as out: out.write(content)
        os.chmod(target,0o444)
print(json.dumps({'ready':True}))
`
