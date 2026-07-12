export type SessionLike = {
  kind: string;
  sessionDate: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

function getLimaComponents(now: Date) {
  const limaMs = now.getTime() - 5 * 60 * 60 * 1000;
  const d = new Date(limaMs);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const jsDow = d.getUTCDay();
  const isoDow = jsDow === 0 ? 7 : jsDow;
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { dateStr, isoDow, minutes };
}

export function isSessionPast(session: SessionLike, now: Date): boolean {
  if (!session.endTime) return false;

  const [h, m] = session.endTime.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return false;
  const endMinutes = h * 60 + m;

  const lima = getLimaComponents(now);

  if (session.kind === "extra") {
    if (!session.sessionDate) return false;
    if (session.sessionDate < lima.dateStr) return true;
    if (session.sessionDate === lima.dateStr && endMinutes <= lima.minutes) return true;
    return false;
  }

  return session.dayOfWeek === lima.isoDow && endMinutes <= lima.minutes;
}
