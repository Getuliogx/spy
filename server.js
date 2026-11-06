const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const GQL = 'https://gql.twitch.tv/gql';
const CLIENT_ID = process.env.TWITCH_GQL_CLIENT_ID || 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGE = 100;
const MAX = 3000;
const cache = new Map();

const QUERY = `query($login:String!,$first:Int!,$after:Cursor){
  user(login:$login){
    login displayName profileImageURL(width:70)
    follows(first:$first,after:$after){
      totalCount
      edges{ cursor followedAt node{ login displayName profileImageURL(width:70) stream{ viewersCount } } }
    }
  }
}`;

async function gql(login, after) {
  const r = await fetch(GQL, {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ query: QUERY, variables: { login, first: PAGE, after } }),
  });
  if (!r.ok) throw new Error('A Twitch respondeu com erro HTTP ' + r.status);
  const j = await r.json();
  if (j.errors && !j.data) throw new Error(j.errors[0].message);
  return j;
}

async function getFollows(login) {
  const hit = cache.get(login);
  if (hit && Date.now() - hit.t < 5 * 60 * 1000) return hit.d;

  let after = null, user = null, total = 0;
  const follows = [];
  while (follows.length < MAX) {
    const j = await gql(login, after);
    const u = j.data && j.data.user;
    if (!u) return { notFound: true };
    user = user || { login: u.login, displayName: u.displayName, avatar: u.profileImageURL };
    const errs = (j.errors || []).map(x => x.message).join(' | ');
    if (!u.follows || u.follows.totalCount == null) {
      throw new Error('A Twitch não devolveu a lista. Resposta dela: ' + (errs || 'nenhum erro informado, campo follows veio vazio'));
    }
    total = u.follows.totalCount;
    const edges = u.follows.edges || [];
    for (const e of edges) {
      if (!e.node) continue;
      follows.push({
        login: e.node.login,
        name: e.node.displayName,
        avatar: e.node.profileImageURL,
        followedAt: e.followedAt,
        live: !!e.node.stream,
        viewers: e.node.stream ? e.node.stream.viewersCount : 0,
      });
    }
    if (edges.length < PAGE) break;
    after = edges[edges.length - 1].cursor;
  }
  const d = { user, total, truncated: total > follows.length, follows };
  cache.set(login, { t: Date.now(), d });
  return d;
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/follows') {
    const login = (url.searchParams.get('user') || '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z0-9_]{1,25}$/.test(login)) return send(res, 400, { error: 'Nick inválido.' });
    try {
      const d = await getFollows(login);
      if (d.notFound) return send(res, 404, { error: 'Usuário não encontrado.' });
      return send(res, 200, d);
    } catch (e) {
      return send(res, 502, { error: e.message });
    }
  }
  fs.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8', (err, html) =>
    err ? send(res, 500, 'index.html não encontrado', 'text/plain') : send(res, 200, html, 'text/html'));
}).listen(PORT, () => console.log('Rodando na porta ' + PORT));
