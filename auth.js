const fs = require('fs');
const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');

const creds = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));

const oAuth2Client = new google.auth.OAuth2(
  creds.client_id,
  creds.client_secret,
  creds.redirect_uri
);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/gmail.send'],
});

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost:3000');
    if (url.pathname !== '/oauth2callback') {
      res.end('Waiting for login...');
      return;
    }

    const code = url.searchParams.get('code');
    if (!code) {
      res.end('No code received.');
      return;
    }

    const { tokens } = await oAuth2Client.getToken(code);
    fs.writeFileSync('token.json', JSON.stringify(tokens, null, 2));

    res.end('Success! You can close this page and return to Termux.');
    console.log('\nLogin successful. token.json saved.');
    server.close();
  } catch (err) {
    res.end('Error: ' + err.message);
    console.error('Error:', err.message);
    server.close();
  }
});

server.listen(3000, () => {
  console.log('Open this link in your browser and sign in:\n');
  console.log(authUrl);
  console.log('\nWaiting for login...');
});
