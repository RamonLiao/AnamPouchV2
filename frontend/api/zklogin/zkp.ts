const ENOKI_ZKP_URL = 'https://api.enoki.mystenlabs.com/v1/zklogin/zkp';

interface VercelRequest {
  method?: string;
  body?: unknown;
}

interface VercelResponse {
  status(code: number): VercelResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

interface ZkpRequestBody {
  jwt?: string;
  ephemeralPublicKey?: string;
  maxEpoch?: number | string;
  randomness?: string;
  network?: string;
}

function getBody(req: VercelRequest): ZkpRequestBody {
  if (typeof req.body === 'string') {
    return JSON.parse(req.body) as ZkpRequestBody;
  }
  return (req.body ?? {}) as ZkpRequestBody;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.ENOKI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'ENOKI_API_KEY is not configured' });
    return;
  }

  let body: ZkpRequestBody;
  try {
    body = getBody(req);
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const { jwt, ephemeralPublicKey, maxEpoch, randomness, network = 'testnet' } = body;
  if (!jwt || !ephemeralPublicKey || maxEpoch === undefined || !randomness) {
    res.status(400).json({
      error: 'Missing jwt, ephemeralPublicKey, maxEpoch, or randomness',
    });
    return;
  }

  const enokiRes = await fetch(ENOKI_ZKP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'zklogin-jwt': jwt,
    },
    body: JSON.stringify({
      network,
      ephemeralPublicKey,
      maxEpoch: Number(maxEpoch),
      randomness,
    }),
  });

  const text = await enokiRes.text();
  if (!enokiRes.ok) {
    res.status(enokiRes.status).json({
      error: 'Enoki ZKP request failed',
      details: text,
    });
    return;
  }

  res.status(200).json(JSON.parse(text));
}
