export const DEFAULT_SCHEDULE = Object.freeze({
  enabled: false,
  intervalHours: 6,
  fullIntervalDays: 7
});

export const SCHEDULE_LIMITS = Object.freeze({
  intervalHours: Object.freeze({ minimum: 1, maximum: 24 }),
  fullIntervalDays: Object.freeze({ minimum: 1, maximum: 30 })
});

function boundedInteger(value, fallback, { minimum, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

export function normalizeScheduleConfig(value) {
  const schedule = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    enabled: schedule.enabled === true,
    intervalHours: boundedInteger(
      schedule.intervalHours,
      DEFAULT_SCHEDULE.intervalHours,
      SCHEDULE_LIMITS.intervalHours
    ),
    fullIntervalDays: boundedInteger(
      schedule.fullIntervalDays,
      DEFAULT_SCHEDULE.fullIntervalDays,
      SCHEDULE_LIMITS.fullIntervalDays
    )
  };
}

export function validateScheduleRequest(value, validationError) {
  const schedule = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const errors = [];
  for (const [field, limits] of Object.entries(SCHEDULE_LIMITS)) {
    const parsed = Number(schedule[field]);
    if (!Number.isInteger(parsed) || parsed < limits.minimum || parsed > limits.maximum) {
      errors.push(validationError(
        `schedule.${field}`,
        'invalid-range',
        `${field === 'intervalHours' ? 'Sync interval' : 'Full Sync interval'} must be a whole number from ${limits.minimum} to ${limits.maximum}.`
      ));
    }
  }
  return {
    errors,
    schedule: {
      enabled: schedule.enabled === true,
      intervalHours: Number(schedule.intervalHours),
      fullIntervalDays: Number(schedule.fullIntervalDays)
    }
  };
}
