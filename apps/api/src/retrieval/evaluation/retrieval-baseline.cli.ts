import process from 'node:process'

import { createRetrievalBaselineReport } from './retrieval-baseline.js'

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify(await createRetrievalBaselineReport(), null, 2)}\n`)
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
