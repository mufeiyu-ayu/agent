/** 请求指定（或默认）的模型行当前不能用：不存在、前台不可见、所属 Provider 已停用，或密钥无法解密。 */
export class LlmModelUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmModelUnavailableError'
  }
}
