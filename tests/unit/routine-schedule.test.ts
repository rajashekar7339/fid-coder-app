// Tests the shared schedule rules used by the Routines dialog and agent tools.

import assert from "node:assert/strict";
import test from "node:test";
import {
  cronFromSchedule,
  describeRunAt,
  localDateTimeIso,
  nextLocalDateForTime,
  parseClock,
  routineScheduleLabel,
  scheduleFromCron,
  scheduleFromRoutine,
} from "../../src/shared/routine-schedule.ts";

const CRON_DAILY = "0 9 * * *";
const CRON_WEEKDAYS = "30 16 * * 1-5";
const CRON_WEEKLY = "0 10 * * 3";

test("reads the dialog schedule from a recurring cron", () => {
  assert.deepEqual(scheduleFromCron(CRON_DAILY), {
    frequency: "daily",
    time: "09:00",
    weekday: "1",
    date: "",
    custom: "",
  });
  assert.deepEqual(scheduleFromCron(CRON_WEEKDAYS), {
    frequency: "weekdays",
    time: "16:30",
    weekday: "1",
    date: "",
    custom: "",
  });
  assert.deepEqual(scheduleFromCron(CRON_WEEKLY), {
    frequency: "weekly",
    time: "10:00",
    weekday: "3",
    date: "",
    custom: "",
  });
});

test("keeps an unrecognized cron as custom timing", () => {
  const schedule = scheduleFromCron("0 9 1 * *");
  assert.equal(schedule.frequency, "custom");
  assert.equal(schedule.custom, "0 9 1 * *");
});

test("writes cron for recurring schedules and a date-based cron for one-time runs", () => {
  assert.equal(
    cronFromSchedule({ frequency: "daily", time: "09:00", weekday: "1", date: "", custom: "" }),
    "0 9 * * *",
  );
  assert.equal(
    cronFromSchedule({ frequency: "weekdays", time: "16:30", weekday: "1", date: "", custom: "" }),
    "30 16 * * 1-5",
  );
  assert.equal(
    cronFromSchedule({ frequency: "weekly", time: "10:00", weekday: "3", date: "", custom: "" }),
    "0 10 * * 3",
  );
  const once = cronFromSchedule({
    frequency: "once",
    time: "16:00",
    weekday: "1",
    date: "2026-11-12",
    custom: "",
  });
  assert.match(once, /^\d{1,2} 16 12 11 \*$/);
});

test("round-trips a one-time routine through the dialog schedule", () => {
  const runAt = localDateTimeIso("2026-11-12", "16:00");
  assert.ok(runAt);
  const schedule = scheduleFromRoutine({ once: true, runAt, cron: "0 16 12 11 *" });
  assert.equal(schedule.frequency, "once");
  assert.equal(schedule.date, "2026-11-12");
  assert.equal(schedule.time, "16:00");
});

test("rejects impossible local dates and times", () => {
  assert.equal(localDateTimeIso("2026-02-30", "09:00"), null);
  assert.equal(localDateTimeIso("2026-11-12", "25:00"), null);
  assert.equal(localDateTimeIso("12-11-2026", "09:00"), null);
  assert.deepEqual(parseClock("00:05"), { hour: 0, minute: 5 });
  assert.equal(parseClock("9:5"), null);
});

test("uses the next occurrence of a time and rolls past times to tomorrow", () => {
  const now = new Date(2026, 10, 11, 17, 0, 0);
  assert.equal(nextLocalDateForTime(now, "18:00"), "2026-11-11");
  assert.equal(nextLocalDateForTime(now, "16:00"), "2026-11-12");
  assert.equal(nextLocalDateForTime(now, "bad"), null);
});

test("labels one-time and recurring routines", () => {
  const now = new Date(2026, 10, 11, 12, 0, 0);
  const runAt = localDateTimeIso("2026-11-11", "16:00");
  assert.ok(runAt);
  assert.match(routineScheduleLabel({ once: true, runAt, cron: "0 16 11 11 *" }, now), /^Once · Today, 4:00/);
  assert.match(describeRunAt(runAt, now), /^Today, 4:00/);
  assert.match(routineScheduleLabel({ once: false, runAt: null, cron: CRON_WEEKDAYS }, now), /^Weekdays at 4:30/);
});
