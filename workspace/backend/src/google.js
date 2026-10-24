const axios = require('axios');

async function getGoogleUser(code, config) {
  const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
    redirect_uri: config.callbackUrl,
    grant_type: 'authorization_code'
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
    maxRedirects: 0,
    proxy: false
  });
  const { access_token: accessToken, token_type: tokenType } = tokenResponse.data;
  if (typeof accessToken !== 'string' || !accessToken || typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    throw new Error('Invalid Google token response');
  }
  // Identity comes only from Google's authenticated HTTPS OpenID Connect endpoint.
  // No browser-supplied profile or unverified ID-token payload is trusted.
  const { data } = await axios.get('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 10000,
    maxRedirects: 0,
    proxy: false
  });
  if (typeof data.sub !== 'string' || !data.sub || typeof data.email !== 'string' || !data.email || data.email_verified !== true) {
    throw new Error('Invalid or unverified Google identity');
  }
  return {
    id: data.sub,
    name: typeof data.name === 'string' ? data.name : '',
    email: data.email,
    picture: typeof data.picture === 'string' ? data.picture : ''
  };
}

module.exports = { getGoogleUser };
