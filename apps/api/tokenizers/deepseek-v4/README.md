# DeepSeek V4 tokenizer artifact

- Source: `deepseek-ai/DeepSeek-V4-Pro@b5968e9190ef611bbf34a7229255be88a0e937c1`
- V4 Flash source revision: `60d8d70770c6776ff598c94bb586a859a38244f1`
- Both official repositories expose the same `tokenizer.json` SHA-256: `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf`
- `tokenizer.json.gz` is a deterministic `gzip -n` copy; SHA-256: `8c13ea99c87004f6d7b0a025f7be22ddf2ec17846f242737ffb231ac5bfbee80`
- License: MIT, inherited from the official DeepSeek V4 model repositories.

The runtime loads these local files once during dependency construction. It never downloads tokenizer data in the request path.
