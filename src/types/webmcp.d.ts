type WebMCPTool = {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
}

type WebMCPContext = {
  registerTool: (tool: WebMCPTool, options?: { signal?: AbortSignal; exposedTo?: string[] }) => void
  unregisterTool?: (name: string) => void
}

declare global {
  interface Document {
    modelContext?: WebMCPContext
  }

  interface Navigator {
    modelContext?: WebMCPContext
  }
}

export {}
