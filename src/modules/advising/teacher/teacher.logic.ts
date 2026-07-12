export type AdvisingModality = "classroom" | "virtual" | "hybrid";

export type TimeRange = { start: string; end: string };

export function toMinutes(time: string): number {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
}

export function isoDayOfWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
  return js === 0 ? 7 : js;
}

export function isValidTimeRange(start: string, end: string): boolean {
  return toMinutes(start) < toMinutes(end);
}

export function rangesOverlap(a: TimeRange, b: TimeRange): boolean {
  return toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end);
}

export function isDateWithinPeriod(dateStr: string, periodStart: string, periodEnd: string): boolean {
  return dateStr >= periodStart && dateStr <= periodEnd;
}

export function isDateInPast(dateStr: string, today: string): boolean {
  return dateStr < today;
}

export function limaDateString(now: Date): string {
  return new Date(now.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function hasRequiredLocation(
  modality: AdvisingModality,
  classroom?: string | null,
  meetingUrl?: string | null,
): boolean {
  const hasRoom = !!classroom && classroom.trim().length > 0;
  const hasUrl = !!meetingUrl && meetingUrl.trim().length > 0;
  if (modality === "classroom") return hasRoom;
  if (modality === "virtual") return hasUrl;
  return hasRoom || hasUrl;
}

export function jpViolatesCycleRule(jpTeacherId: number, periodSectionTeacherIds: number[]): boolean {
  return periodSectionTeacherIds.includes(jpTeacherId);
}

export type CreateAdvisingInput = {
  sessionDate: string;
  startTime: string;
  endTime: string;
  modality: AdvisingModality;
  classroom?: string | null;
  meetingUrl?: string | null;
};

export type ExistingAdvising = {
  kind: "recurring" | "extra";
  dayOfWeek: number;
  sessionDate: string | null;
  startTime: string;
  endTime: string;
};

export type CreateValidation =
  | { status: "ok"; dayOfWeek: number }
  | { status: "invalid_time" }
  | { status: "date_in_past" }
  | { status: "date_out_of_period" }
  | { status: "missing_location" }
  | { status: "overlap" };

export function validateCreateAdvising(params: {
  input: CreateAdvisingInput;
  today: string;
  periodStart: string;
  periodEnd: string;
  ownExisting: ExistingAdvising[];
}): CreateValidation {
  const { input, today, periodStart, periodEnd, ownExisting } = params;

  if (!isValidTimeRange(input.startTime, input.endTime)) return { status: "invalid_time" };
  if (isDateInPast(input.sessionDate, today)) return { status: "date_in_past" };
  if (!isDateWithinPeriod(input.sessionDate, periodStart, periodEnd)) return { status: "date_out_of_period" };
  if (!hasRequiredLocation(input.modality, input.classroom, input.meetingUrl)) return { status: "missing_location" };

  const dayOfWeek = isoDayOfWeek(input.sessionDate);
  const newRange: TimeRange = { start: input.startTime, end: input.endTime };
  const overlaps = ownExisting
    .filter((e) => (e.kind === "extra" ? e.sessionDate === input.sessionDate : e.dayOfWeek === dayOfWeek))
    .some((e) => rangesOverlap(newRange, { start: e.startTime, end: e.endTime }));
  if (overlaps) return { status: "overlap" };

  return { status: "ok", dayOfWeek };
}
