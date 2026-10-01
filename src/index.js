const PAGE = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Email Sender</title>
<style>
  body { font-family: sans-serif; max-width: 480px; margin: 20px auto; padding: 0 12px; }
  input, textarea, button { width: 100%; box-sizing: border-box; padding: 10px; margin: 6px 0; font-size: 16px; }
  textarea { height: 140px; }
  #status { margin-top: 10px; font-weight: bold; }
</style>
</head>
<body>
<h2>Send Email</h2>
<input id="key" type="password" placeholder="Access key">
<input id="to" type="email" placeholder="Send to (email address)">
<input id="subject" type="text" placeholder="Subject">
<textarea id="message" placeholder="Message"></textarea>
<button id="send">Send</button>
<div id="status"></div>
<script>
document.getElementById('send').onclick = async function () {
  var status = document.getElementById('status');
  status.textContent = 'Sending...';
  try {
    var res = await fetch('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        key: document.getElementById('key').value,
        to: document.getElementById('to').value,
        subject: document.getElementById('subject').value,
        message: document.getElementById('message').value
      })
    });
    var data = await res.json();
    status.textContent = data.ok ? 'Email sent!' : 'Failed: ' + data.error;
  } catch (e) {
    status.textContent = 'Failed: ' + e.message;
  }
};
</script>
</body>
</html>`;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function toBase64Url(str) {
  return toBase64(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getAccessToken(env) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      refresh_token: env.REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Token error: ' + (data.error_description || data.error));
  }
  return data.access_token;
}

async function sendEmail(env, to, subject, message) {
  const accessToken = await getAccessToken(env);

  const raw = toBase64Url(
    [
      `To: ${to}`,
      `Subject: =?utf-8?B?${toBase64(subject)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      toBase64(message),
    ].join('\r\n')
  );

  const res = await fetch(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || 'Gmail API error');
  }
  return data;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response(PAGE, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (request.method === 'POST' && url.pathname === '/send') {
      try {
        const { key, to, subject, message } = await request.json();

        if (!env.ACCESS_KEY || key !== env.ACCESS_KEY) {
          return json({ ok: false, error: 'Wrong access key' }, 401);
        }
        if (!to || !to.includes('@') || /[\r\n]/.test(to) || /[\r\n]/.test(subject || '')) {
          return json({ ok: false, error: 'Invalid recipient or subject' }, 400);
        }

        const result = await sendEmail(env, to.trim(), subject || '', message || '');
        return json({ ok: true, id: result.id });
      } catch (err) {
        return json({ ok: false, error: err.message }, 500);
      }
    }

    return new Response('Not found', { status: 404 });
  },
};
