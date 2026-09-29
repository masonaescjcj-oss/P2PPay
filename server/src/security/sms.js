'use strict';

// SMS delivery. `console` prints the message to the server log (development only).
function createSmsSender(config, { log = console, fetchImpl = fetch } = {}) {
  const s = config.sms || {};
  if (s.provider === 'twilio') {
    if (!s.twilioSid || !s.twilioToken || !s.twilioFrom) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
    const auth = Buffer.from(`${s.twilioSid}:${s.twilioToken}`).toString('base64');
    return async (to, text) => {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${s.twilioSid}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: s.twilioFrom, Body: text }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`SMS provider HTTP ${res.status}`);
    };
  }
  if (s.provider === 'console') {
    if (config.nodeEnv === 'production') throw new Error('SMS_PROVIDER=console is not allowed in production');
    return async (to, text) => log.warn(`[sms → ${to}] ${text}`);
  }
  throw new Error(`unknown SMS_PROVIDER ${s.provider}`);
}

module.exports = { createSmsSender };
