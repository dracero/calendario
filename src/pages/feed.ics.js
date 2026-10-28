import { loadMeetings, generateIcsFeed } from '../lib/server-utils.js';

export const GET = async () => {
  const meetings = loadMeetings();
  const icsContent = generateIcsFeed(meetings);
  return new Response(icsContent, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="reuniones.ics"',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    }
  });
};
