export class DesignTurns {
  private seen = new Map<string, string>();
  first(conversation: string, turn: string) {
    if (this.seen.get(conversation) === turn) return false;
    this.seen.set(conversation, turn);
    if (this.seen.size > 128) this.seen.delete(this.seen.keys().next().value ?? "");
    return true;
  }
  forget(conversation: string) { this.seen.delete(conversation); }
}
