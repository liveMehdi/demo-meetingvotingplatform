export function meetingTimeChoices(value: string): string[] {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const [year, month, day, hour, minute] = value.split(/[-T:]/).map(Number);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  )
    return [];

  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  wall.setUTCHours(hour, minute, 0, 0);

  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    offsets.add(new Date(wall.getTime() + hours * 3600000).getTimezoneOffset());
  }

  const choices: string[] = [];

  for (const offset of offsets) {
    const date = new Date(wall.getTime() + offset * 60000);
    if (
      date.getFullYear() === year &&
      date.getMonth() + 1 === month &&
      date.getDate() === day &&
      date.getHours() === hour &&
      date.getMinutes() === minute &&
      date.getSeconds() === 0 &&
      date.getUTCFullYear() >= 1 &&
      date.getUTCFullYear() <= 9999
    )
      choices.push(date.toISOString());
  }
  return choices.sort();
}
