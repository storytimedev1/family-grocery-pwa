const RECIPIENT_EMAIL = 'you@example.com';
const TIME_ZONE = 'America/Toronto';

// From the South Frontenac 2026 schedule:
// Wednesday Jan 7, 2026 is Week 2 - Paper/cardboard, then it alternates weekly.
const WEDNESDAY_ANCHOR = { year: 2026, month: 1, day: 7 };

function sendWeeklyRecyclingReminder() {
  const today = new Date();
  const recycling = getWednesdayRecyclingType(today);
  const collectionDate = Utilities.formatDate(today, TIME_ZONE, 'EEEE, MMMM d, yyyy');

  MailApp.sendEmail({
    to: RECIPIENT_EMAIL,
    subject: `Recycling this week: ${recycling.shortName}`,
    body: [
      `This week is ${recycling.displayName}.`,
      '',
      `Collection day: ${collectionDate}`,
      '',
      'Source: South Frontenac 2026 recycling collection schedule.'
    ].join('\n')
  });
}

function getWednesdayRecyclingType(date) {
  const year = Number(Utilities.formatDate(date, TIME_ZONE, 'yyyy'));
  const month = Number(Utilities.formatDate(date, TIME_ZONE, 'M'));
  const day = Number(Utilities.formatDate(date, TIME_ZONE, 'd'));
  const daysSinceAnchor = (Date.UTC(year, month - 1, day) - Date.UTC(WEDNESDAY_ANCHOR.year, WEDNESDAY_ANCHOR.month - 1, WEDNESDAY_ANCHOR.day)) / (24 * 60 * 60 * 1000);
  const weeksSinceAnchor = Math.round(daysSinceAnchor / 7);
  const isPaperCardboardWeek = weeksSinceAnchor % 2 === 0;

  return isPaperCardboardWeek
    ? {
        shortName: 'Paper/cardboard',
        displayName: 'Paper/cardboard recycling week'
      }
    : {
        shortName: 'Containers',
        displayName: 'Containers recycling week: plastic, cans, glass, and cartons'
      };
}

function setupWednesdayTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'sendWeeklyRecyclingReminder')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));

  ScriptApp.newTrigger('sendWeeklyRecyclingReminder')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
    .atHour(7)
    .inTimezone(TIME_ZONE)
    .create();
}

function sendTestEmail() {
  sendWeeklyRecyclingReminder();
}
