import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth';

type Bindings = {
  BUCKET: R2Bucket;
  TOKEN: string;
}

function isObjectBody(obj: R2Object | R2ObjectBody): obj is R2ObjectBody {
  if ("body" in obj) {
    return true;
  }
  return false
}

const app = new Hono<{ Bindings: Bindings }>();

app.get('/', (c) => {
  return c.text("Welcome to white space.");
})

app.get('/:name', async (c) => {
  const bucket = c.env.BUCKET;
  const { name } = c.req.param();

  const res = await bucket.get(name, {
    range: c.req.raw.headers,
    onlyIf: c.req.raw.headers
  })

  if (res === null) {
    c.status(404);
    return c.text("not found");
  }

  const headers = new Headers();
  res.writeHttpMetadata(headers);
  headers.set("etag", res.httpEtag);
  headers.set("accept-ranges", "bytes")
  if (res.range) {
    const range = res.range as any;
    headers.set("content-range", `bytes ${range.offset}-${range.end ?? res.size - 1}/${res.size}`)
  }
  if (isObjectBody(res)) {
    const status = c.req.raw.headers.get("range") !== null ? 206 : 200;
    return new Response(res.body, {
      status,
      headers
    })
  } else {
    return new Response(undefined, {
      status: 304,
      headers
    })
  }
})

app.use("*", async (c, next) => {
  const rawToken = new TextEncoder().encode(c.env.TOKEN);
  const hashedToken = await crypto.subtle.digest({
    name: "SHA-1"
  }, rawToken);

  // Convert the hashed token into hex format.
  // https://stackoverflow.com/questions/63397714/not-able-to-create-md5-hash-on-cloudflare-worker-script
  const token = Array.from(new Uint8Array(hashedToken)).map(b => b.toString(16).padStart(2, '0')).join('');

  const bearer = bearerAuth({ token });
  return bearer(c, next);
})

app.post('/upload/:name', async (c) => {
  const bucket = c.env.BUCKET;
  const name = c.req.param('name')

  const bodyStream = c.req.raw.body;
  if (bodyStream === null) {
    return new Response("Empty body", {
      status: 400
    })
  }

  try {
    const res = await bucket.put(name, bodyStream);
    return new Response(res?.key)
  } catch (e) {
    console.log(e);
    return new Response(`${e}`, {
      status: 500
    })
  }
})

app.post('/upload-part/init/:name', async (c) => {
  const key = c.req.param("name");
  const multipart = await c.env.BUCKET.createMultipartUpload(key);

  return new Response(JSON.stringify({
    key: multipart.key,
    uploadId: multipart.uploadId
  }));
})

app.put('/upload-part/put/:name/:uploadId', async (c) => {
  const { name, uploadId } = c.req.param();
  const partQuery = c.req.query("partNumber")

  if (partQuery === undefined) {
    return new Response("missing_part_number", {
      status: 400
    })
  }

  const partNumber = parseInt(partQuery);

  if (c.req.raw.body === null) {
    return new Response("missing_body", {
      status: 400
    })
  }

  const multipart = c.env.BUCKET.resumeMultipartUpload(name, uploadId);
  try {
    const res = await multipart.uploadPart(partNumber, c.req.raw.body);
    return new Response(JSON.stringify(res));
  } catch (e: any) {
    return new Response(`${e}`, {
      status: 500
    })
  }
})

app.post("/upload-part/finish/:name/:uploadId", async (c) => {
  const { name, uploadId } = c.req.param();
  
  if (c.req.raw.body === null) {
    return new Response("missing_parts", { status: 400 })
  }
  const parts: R2UploadedPart[] = await c.req.json();

  const multipart = c.env.BUCKET.resumeMultipartUpload(name, uploadId);

  try {
    const res = await multipart.complete(parts)
    return new Response(res.key)
  } catch (e: any) {
    return new Response(`"${e}`, {
      status: 500
    })
  }
})

export default app
