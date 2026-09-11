# Ubuntu 内网部署

本项目是纯静态 Vue + Element Plus 原型。构建后只需部署 `dist/`，不需要在服务器常驻 Node.js 或 Vite。

## 构建与上传

在 Windows 项目目录执行：

```powershell
npm ci
npm run build
Compress-Archive -Path dist\* -DestinationPath whitelist-release.zip -Force
```

将压缩包上传到 Ubuntu。服务器使用 Nginx，将站点根目录设为 `/srv/attribution-device-whitelist/current`，并用 `try_files $uri $uri/ /index.html;` 支持单页应用刷新。

## Nginx 初始化

```bash
sudo apt update && sudo apt install -y nginx
sudo mkdir -p /srv/attribution-device-whitelist/releases
sudo chown -R $USER:$USER /srv/attribution-device-whitelist
```

创建 `/etc/nginx/sites-available/attribution-device-whitelist`：

```nginx
server {
    listen 80;
    server_name _;
    root /srv/attribution-device-whitelist/current;
    index index.html;

    location / { try_files $uri $uri/ /index.html; }
    location /assets/ {
        try_files $uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
    location = /index.html { add_header Cache-Control "no-cache"; }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/attribution-device-whitelist /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

## 推荐发布方式

```bash
release=/srv/attribution-device-whitelist/releases/$(date +%Y%m%d%H%M%S)
mkdir -p "$release"
unzip whitelist-release.zip -d "$release"
ln -sfn "$release" /srv/attribution-device-whitelist/current
sudo nginx -t && sudo systemctl reload nginx
```

Nginx 仅开放 80 端口给公司内网或 VPN 网段。每次发布只上传新的构建包并切换 `current` 链接，旧版本保留在 `releases/` 中以便回退。

## 原型边界

设备数据仅存在访问者浏览器内存中；清空操作为交互模拟，不会调用或删除真实联调数据。
