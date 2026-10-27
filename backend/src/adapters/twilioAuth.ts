export function getTwilioRequestAuth() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid || !/^AC[0-9a-f]{32}$/i.test(accountSid)) {
    throw new Error('TWILIO_ACCOUNT_SID must be the Account SID beginning with AC. An API key SID beginning with SK is not an Account SID.');
  }

  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiSecret = process.env.TWILIO_API_SECRET;
  let username: string;
  let password: string;
  if (apiKeySid || apiSecret) {
    if (!apiKeySid || !/^SK[0-9a-f]{32}$/i.test(apiKeySid) || !apiSecret) {
      throw new Error('Set both TWILIO_API_KEY_SID (beginning with SK) and TWILIO_API_SECRET.');
    }
    username = apiKeySid;
    password = apiSecret;
  } else {
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!authToken) throw new Error('Set TWILIO_AUTH_TOKEN, or configure TWILIO_API_KEY_SID with TWILIO_API_SECRET.');
    username = accountSid;
    password = authToken;
  }

  return {
    accountSid,
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
  };
}
