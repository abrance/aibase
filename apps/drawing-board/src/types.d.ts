declare module "@aibase/sdk" {
  interface AibaseClientOptions {
    baseUrl?: string;
  }

  interface Session {
    id: string;
    title?: string;
  }

  interface PromptBody {
    text: string;
    agent?: string;
    model?: string;
    system?: string;
  }

  type SseEventCallback = (event: string, data: unknown) => void;

  interface SessionsAPI {
    list(opts?: {
      archived?: boolean;
      search?: string;
      limit?: number;
    }): Promise<Session[]>;
    create(body?: {
      title?: string;
      permission?: unknown;
    }): Promise<Session>;
    getMessages(
      sessionId: string,
      limit?: number,
    ): Promise<unknown[]>;
    prompt(
      sessionId: string,
      body: PromptBody,
    ): Promise<unknown>;
    promptStream(
      sessionId: string,
      body: PromptBody,
      onEvent: SseEventCallback,
    ): Promise<void>;
    updateTitle(sessionId: string, title: string): Promise<unknown>;
    archive(
      sessionId: string,
      archived?: boolean,
    ): Promise<unknown>;
    respondPermission(
      sessionId: string,
      permissionId: string,
      allow: boolean,
    ): Promise<unknown>;
  }

  interface AibaseClient {
    health(): Promise<unknown>;
    sessions: SessionsAPI;
  }

  function createAibaseClient(
    options?: AibaseClientOptions,
  ): AibaseClient;

  export { createAibaseClient };
  export type {
    AibaseClient,
    SessionsAPI,
    Session,
    PromptBody,
    SseEventCallback,
  };
}
