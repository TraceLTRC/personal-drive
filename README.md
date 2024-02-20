# Personal file sharing web service

This is a cloudflare worker that exposes an R2 bucket through its binding. It allows getting bucket objects and uploading files to the bucket (singlepart and multipart uploads).

Do note that multipart uploading is a process that requires state handling. It is expected that the client will be the one to handle these states.

## Install & Deploy

Before deploying, make sure to rename the bucket binding in `wrangler.toml` 

```
npm install
npm run deploy
```
