const avatars = Array.from(
  { length: 8 },
  (_, index) => `bot-${String(index).padStart(2, "0")}`,
);

export function defaultAvatar(used: (string | undefined)[]) {
  return (
    avatars.find((avatar) => !used.includes(avatar)) ??
    avatars[used.length % avatars.length]
  );
}
