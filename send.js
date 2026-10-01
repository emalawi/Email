const fs = require('fs');
const readline = require('readline');
const { google } = require('googleapis');

const creds = JSON.parse(fs.readFileSync('credentials.json', 'utf8'));
const token = JSON.parse(fs.readFileSync('token.json', 'utf8'));

const oAuth2Client = new google.auth.OAuth2(
  creds.client_id,
  creds.client_secret,
  creds.redirect_uri
);
oAuth2Client.setCredentials(token);

const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function encodeSubject(subject) {
  return '=?utf-8?B?' + Buffer.from(subject, 'utf8').toString('base64') + '?=';
}

function buildMessage(to, subject, body) {
  const message = [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(message, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function main() {
  const to = (await ask('Send to (email address): ')).trim();
  const subject = (await ask('Subject: ')).trim();
  const body = await ask('Message: ');
  rl.close();

  if (!to.includes('@')) {
    console.error('Invalid email address.');
    return;
  }

  try {
    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: buildMessage(to, subject, body) },
    });
    console.log('Email sent! Message ID:', res.data.id);
  } catch (err) {
    console.error('Failed to send:', err.message);
  }
}

main();
