# StudentShield v4 — chạy không cần database

Ứng dụng bảo mật sinh viên bằng Node.js 24 + Express và HTML/CSS/JavaScript. **Không cần PostgreSQL, Prisma, Docker hoặc cấu hình `.env` để chạy trên máy cá nhân.**

## Chạy ngay trên Windows / PowerShell

Mở terminal tại thư mục có `package.json`:

```powershell
npm install
npm run dev
```

Mở `http://localhost:8080`. Lần sau chỉ cần `npm run dev`. Khi tải lại ZIP từ GitHub, giải nén vào thư mục riêng; không ghi đè hoặc xóa thư mục `data/` chứa dữ liệu đã có.

Nếu đã cài bản cũ, chạy lại `npm install` để cập nhật thư viện. `DATABASE_URL` còn trong `.env` cũ sẽ bị bỏ qua; không chạy `npx prisma ...` hay `docker compose ...` nữa. Không có chuyển dữ liệu PostgreSQL cũ tự động sang file JSON.

Không cần tạo `.env` hoặc khóa thủ công. Cấu hình tùy chọn có trong `.env.example`. App mặc định chỉ lắng nghe `127.0.0.1`, cổng 8080. `npm start` chạy không có chế độ theo dõi file.

## Đăng ký và email thử nghiệm

1. Đăng ký tài khoản bằng giao diện.
2. Mở terminal thứ hai tại cùng thư mục, chạy:

```powershell
npm run mail
```

3. Mở liên kết xác minh được hiển thị, rồi đăng nhập.

Quên mật khẩu cũng dùng hộp thư này. Chế độ `MAIL_MODE=file` chỉ mô phỏng gửi email bằng file trên máy; không gửi đến hộp thư thật và không chứng minh quyền sở hữu địa chỉ email. Không có API công khai để đọc hộp thư thử nghiệm. Muốn gửi thật, đặt `MAIL_MODE=smtp` và cấu hình SMTP riêng.

## Dữ liệu nằm ở đâu?

- `data/store.json`: tài khoản, mật khẩu băm Argon2id, thông tin trường, bài học, nhật ký, token băm, TOTP đã mã hóa và phiên đăng nhập.
- `data/keys.json`: khóa ký phiên và khóa mã hóa TOTP được tạo tự động, giữ nguyên qua các lần khởi động.
- `data/mail/`: email thử nghiệm, có thể chứa liên kết xác minh hoặc đặt lại mật khẩu.
- `data/store.lock`: ngăn hai tiến trình cùng ghi đè dữ liệu. Chạy một tiến trình cho mỗi thư mục dữ liệu. Sau khi tiến trình cũ đã dừng, khóa cũ được tự thu hồi khi khởi động.

Thư mục `data/` và `.env` được bỏ qua bởi Git và Docker build. Sao lưu cả `data/` khi app đã dừng; bảo vệ bằng quyền truy cập của hệ điều hành. Mất khóa mã hóa có thể làm mất khả năng dùng TOTP. Mật khẩu không lưu dạng văn bản thuần. Không xóa dữ liệu hoặc khóa để khắc phục lỗi khởi động; khôi phục bản sao lưu khi file hỏng.

Đây là lưu trữ file cục bộ cho một tiến trình, không phải hệ thống database phân tán. Không dùng nhiều replica hoặc thư mục trên ổ mạng để cùng ghi. Ghi file dùng thay thế nguyên tử; lỗi transaction được hoàn tác trước khi ghi. Dữ liệu PostgreSQL trước đây không bị xóa hoặc thay đổi.

## Tính năng

- Đăng ký, đăng nhập/đăng xuất, liên kết xác minh và đặt mật khẩu một lần; chống CSRF, rate limit, Argon2id, cookie HttpOnly/SameSite.
- TOTP mã hóa, mã khôi phục dùng một lần; quản lý và thu hồi phiên, đổi mật khẩu, nhật ký và cảnh báo.
- Dashboard 0–100 dựa trên dữ liệu tự khai báo; quản lý nhiều tài khoản cần bảo vệ, không lưu mật khẩu tài khoản bên ngoài.
- Hồ sơ và avatar biểu tượng, dark/light, responsive; công cụ mật khẩu xử lý trong trình duyệt; URL phân tích tĩnh không truy cập đích và không cam kết an toàn.
- Phân quyền USER/ADMIN/SUPER_ADMIN; trường học, quản trị trong phạm vi trường, chính sách, bài học và tiến độ; PDF/Excel.

Tạo Super Admin một lần bằng PowerShell: dừng app bằng Ctrl+C trước vì tiện ích quản trị cần quyền ghi độc quyền vào file.

```powershell
$env:BOOTSTRAP_EMAIL = Read-Host 'Email Super Admin'
$secret = Read-Host 'Mật khẩu (ít nhất 12 ký tự)' -AsSecureString
$env:BOOTSTRAP_PASSWORD = [System.Net.NetworkCredential]::new('', $secret).Password
npm run bootstrap
Remove-Item Env:BOOTSTRAP_PASSWORD
Remove-Item Env:BOOTSTRAP_EMAIL
npm run dev
```

Không có tài khoản hoặc mật khẩu Admin mặc định. Bật 2FA sau khi tạo.

## Kiểm thử

```sh
npm test
```

Test tự tạo thư mục tạm và không cần database/SMTP; kiểm tra luồng xác thực, file email, phân quyền theo trường, phiên, 2FA, xuất file, transaction và dữ liệu qua lần khởi động lại. Test trình duyệt cần Chromium hệ thống hoặc:

```sh
npx playwright-core install --with-deps chromium
```

GitHub Actions đã cấu hình kiểm thử tương ứng, không có service PostgreSQL.

## Triển khai VPS (tùy chọn)

Có thể dùng Node.js trực tiếp với process manager, hoặc `compose.production.yaml` cho app + Caddy, không có database service. Mặc định chỉ bind loopback; khi chạy container, dùng `HOST=0.0.0.0`. Mount volume `/app/data` để giữ dữ liệu. Chỉ chạy một container ghi dữ liệu.

Sao chép `deploy/production.env.example` ra ngoài checkout, điền tên miền và SMTP thật. `NODE_ENV=production` yêu cầu HTTPS APP_URL và MAIL_MODE=smtp. Caddy đứng trước app và tự cấp HTTPS; không public trực tiếp cổng app. App tin một reverse proxy; nếu chạy trực tiếp, đặt proxy phù hợp trước khi bật production.

```sh
docker compose --env-file /secure/studentshield.env -f compose.production.yaml up -d --build
```

Chưa có VPS hoặc tên miền được cung cấp, nên chưa triển khai public. Chạy `npm run maintenance` khi app đã dừng để dọn token, phiên và nhật ký cũ (mặc định 90 ngày). Email SMTP chưa có hàng đợi retry. Không coi hộp thư file là xác minh email thật trong môi trường nhiều người dùng.
