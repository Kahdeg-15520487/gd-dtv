# gd-dtv — Google Drive Archive

Search and download from a 293K-file Google Drive archive.  
Web UI + OPDS catalog at https://books.minhnguyenle.net.

## Deploy

```bash
kubectl apply -k k8s/
```

Requires secrets: `rclone-config`, `gdrive-config`, `postgres-secret` (not in git).
