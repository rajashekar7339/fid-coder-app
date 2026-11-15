type ChatMessage = {
  role: string;
  turnId?: string | null;
  turnSource?: string | null;
};

/** Only a user message from a normal chat turn can be edited or deleted. */
export function isEditableUserMessage(message: ChatMessage): boolean {
  return message.role === "user" && Boolean(message.turnId) && message.turnSource === "chat";
}
