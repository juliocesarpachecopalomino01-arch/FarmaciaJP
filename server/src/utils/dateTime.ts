const BUSINESS_TIME_ZONE = 'America/Lima';

type ZonedParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};

function getZonedParts(offsetDays = 0): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const values = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  let year = Number(values.year);
  let month = Number(values.month);
  let day = Number(values.day);

  if (offsetDays !== 0) {
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + offsetDays);
    year = date.getUTCFullYear();
    month = date.getUTCMonth() + 1;
    day = date.getUTCDate();
  }

  const hour = values.hour === '24' ? '00' : values.hour;

  return {
    year: String(year).padStart(4, '0'),
    month: String(month).padStart(2, '0'),
    day: String(day).padStart(2, '0'),
    hour: hour.padStart(2, '0'),
    minute: values.minute.padStart(2, '0'),
    second: values.second.padStart(2, '0'),
  };
}

export function getLocalDateTime(): string {
  const p = getZonedParts();
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

export function getLocalDate(offsetDays = 0): string {
  const p = getZonedParts(offsetDays);
  return `${p.year}-${p.month}-${p.day}`;
}
