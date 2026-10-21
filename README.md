# StudentShield v4.0

Nền tảng bảo mật sinh viên với giao diện HTML/CSS/JavaScript tiếng Việt, Node.js 24 LTS, Express, PostgreSQL và Prisma. Checkout ban đầu chỉ có README; giao diện v4 được xây mới, không có mã v3 để chuyển đổi.

## Chạy phát triển

```sh
npm ci
cp .env.example .env
```

Điền `SESSION_SECRET` (ít nhất 32 ký tự ngẫu nhiên), `DATA_ENCRYPTION_KEY` (32 byte dạng hex). Tạo bằng `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`; dùng hai giá trị khác nhau. Không commit `.env`. Không thay khóa mã hóa khi đã có TOTP nếu chưa có kế hoạch chuyển khóa.

```sh
docker compose up -d
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Ứng dụng dùng cổng 8080. PostgreSQL dùng cổng 5432. Mailpit nhận SMTP ở cổng 1025, hộp thư phát triển ở cổng 8025. Các cổng Docker chỉ bind loopback. Cấu hình mẫu và mật khẩu database mẫu chỉ dành cho phát triển. Cần truy cập `registry.npmjs.org` và Docker Hub để cài công cụ; không tắt kiểm tra TLS/checksum.

Lần đầu, cấu hình `BOOTSTRAP_EMAIL`, `BOOTSTRAP_PASSWORD` qua môi trường riêng rồi chạy `npm run bootstrap`. Lệnh chỉ tạo Super Admin khi chưa có Super Admin. Xóa các biến bootstrap sau đó và bật 2FA. Đăng ký thông thường luôn tạo USER, không cho người dùng tự chọn vai trò. Mã trường dùng để tham gia trường, không phải bí mật phân quyền.

## Các luồng

- Đăng ký, liên kết xác minh email dùng một lần, gửi lại xác minh; đăng nhập và đăng xuất.
- Quên mật khẩu và reset hết hạn sau 30 phút; reset thu hồi phiên nhưng giữ nguyên 2FA.
- Argon2id; session PostgreSQL, cookie HttpOnly/SameSite, Secure khi production; CSRF theo phiên và kiểm tra Origin; Helmet và rate limit.
- TOTP mã hóa AES-256-GCM, mã khôi phục băm một chiều dùng một lần, chặn tái dùng bước TOTP khi đăng nhập. Bật/tắt yêu cầu xác thực lại; thay đổi bảo mật làm vô hiệu các phiên khác.
- Danh sách phiên/thiết bị, thu hồi từ xa; nhật ký, email đăng nhập mới, đổi/reset mật khẩu, thay đổi 2FA và nhiều lần đăng nhập thất bại.
- Hồ sơ, ảnh đại diện dạng biểu tượng có sẵn, đổi mật khẩu; dashboard 0–100 và đề xuất từ dữ liệu tự khai báo.
- Thêm, cập nhật trạng thái và xóa nhiều tài khoản cần bảo vệ. **Không lưu mật khẩu tài khoản bên ngoài.**
- Kiểm tra mật khẩu hoàn toàn trong trình duyệt. Kiểm tra URL bằng quy tắc tĩnh, không truy cập đích: HTTPS, IP, punycode, link rút gọn, URL có thông tin đăng nhập và đường dẫn đáng ngờ. Không có tra cứu danh tiếng hoặc giải redirect; kết quả không xác nhận URL an toàn.
- Bài học và lưu tiến độ; bài toàn hệ thống hoặc trong trường; PDF tổng quan và Excel tài khoản.
- Admin quản lý USER, thống kê và nhật ký trong trường, bài học của trường, xuất Excel. Super Admin tạo trường, cấp ADMIN và chuyển trường; không cho thay đổi tài khoản Super Admin qua API.
- Giao diện responsive, dark/light; chỉ lựa chọn giao diện được lưu ở localStorage. Thông tin tài khoản và xác thực nằm trong PostgreSQL.

Quản trị người dùng hiện giới hạn 200 dòng, nhật ký 100, báo cáo trường 10.000 người dùng. Điểm bảo mật không phải đánh giá độc lập. IP và User-Agent giúp người dùng nhận diện phiên, không phải nhận diện thiết bị đáng tin cậy. Bài học đánh dấu hoàn thành do người dùng tự khai báo, chưa có bài thi.

## Kiểm thử

```sh
npm test
```

Cần Chromium hệ thống (`/usr/bin/chromium`, hoặc `CHROMIUM_PATH`), hoặc chạy `npx playwright-core install --with-deps chromium` cho kiểm thử trình duyệt. Cần một PostgreSQL **dành riêng cho kiểm thử**, schema đã migrate, SMTP Mailpit và API Mailpit ở cổng 8025. Test tạo tài khoản có hậu tố ngẫu nhiên, kiểm tra email nhận được, dữ liệu thực, CSRF, phân quyền theo trường, TOTP, token một lần, thu hồi phiên và xuất file; dọn dữ liệu do test tạo. Không chạy test trên production. Workflow GitHub Actions cung cấp các service tương ứng.

Chỉ kiểm tra mã hóa độc lập: `node --env-file=.env --test test/security.test.js`.

## Triển khai production

Cần máy chủ/nhà cung cấp, tên miền HTTPS, PostgreSQL được quản lý/sao lưu và SMTP thực trước khi public. Chưa có triển khai từ xa được thực hiện trong repository này.

```sh
docker build -t studentshield:4 .
# Đặt biến thực trong file bảo mật bên ngoài checkout, gồm NODE_ENV=production.
# Chạy migration một lần trước khi khởi động phiên bản mới:
docker run --rm --env-file /secure/studentshield.env studentshield:4 npx prisma migrate deploy
docker run -d --name studentshield --restart unless-stopped --env-file /secure/studentshield.env -p 127.0.0.1:8080:8080 studentshield:4
```

Đặt `APP_URL=https://ten-mien-cua-ban`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM` và thông tin SMTP nếu cần. `SMTP_SECURE=true` dành cho TLS ngay từ đầu (thường cổng 465), false cho STARTTLS (thường cổng 587). Không dùng Mailpit trong production. PostgreSQL phải dùng TLS xác minh chứng chỉ theo nhà cung cấp; không vô hiệu kiểm tra chứng chỉ. Proxy HTTPS cần đứng ngay trước app, ghi đè X-Forwarded-For/Proto và chặn truy cập trực tiếp cổng app: Express tin đúng một proxy. Rate limit IP ở bộ nhớ tiến trình, giới hạn đăng nhập theo tài khoản dùng nhật ký PostgreSQL; khi chạy nhiều replica cần bổ sung rate-limit store dùng chung hoặc gateway.

Mật khẩu đăng nhập ít nhất 12, tối đa 128 ký tự. Sau 10 lần đăng nhập thất bại trong 15 phút, tài khoản tạm hạn chế; API auth giới hạn 30 yêu cầu/IP/15 phút. Super Admin có thể chỉnh độ dài mật khẩu tối thiểu (12–64), giới hạn thất bại (3–20) và thời hạn phiên (1–24 giờ) ở trang Chính sách hệ thống. Các thay đổi áp dụng cho mật khẩu mới và phiên mới. Super Admin hiện quản lý trường/quyền, không có quyền thay biến môi trường hoặc bí mật qua giao diện.

Chạy `npm run maintenance` hằng ngày để dọn token, phiên hết hạn và nhật ký cũ hơn `EVENT_RETENTION_DAYS` (mặc định 90 ngày). Email gửi đồng bộ; lỗi gửi cảnh báo được ghi `EMAIL_DELIVERY_FAILED`, chưa có hàng đợi tự retry. Sao lưu PostgreSQL và khóa mã hóa riêng, diễn tập khôi phục. Không ghi token, mật khẩu hoặc secret vào log.

Không thu thập ngày sinh, điểm học tập hoặc dữ liệu sinh viên ngoài tên/email/trường và dữ liệu bảo mật cần thiết. Thời hạn lưu và quyền truy cập nên được thống nhất với đơn vị vận hành trước khi dùng cho trường thật.

### VPS với HTTPS tự động

`compose.production.yaml` chạy PostgreSQL nội bộ, app và Caddy; chỉ public 80/443. Tạo DNS A/AAAA trỏ về VPS, mở 80/443, cài Docker Engine và Compose. Sao chép `deploy/production.env.example` ra `/secure/studentshield.env`, đặt quyền 600 và điền giá trị thực. Mật khẩu trong DATABASE_URL phải được URL-encode, khớp POSTGRES_PASSWORD. Docker network riêng dùng kết nối PostgreSQL nội bộ; nếu dùng database từ xa hãy bật TLS có xác minh chứng chỉ.

```sh
docker compose --env-file /secure/studentshield.env -f compose.production.yaml build
docker compose --env-file /secure/studentshield.env -f compose.production.yaml up -d db
docker compose --env-file /secure/studentshield.env -f compose.production.yaml run --rm app npx prisma migrate deploy
docker compose --env-file /secure/studentshield.env -f compose.production.yaml up -d
```

Cấp bootstrap email/mật khẩu an toàn vào môi trường của container tác vụ riêng để chạy bootstrap một lần; không để chúng trong cấu hình app lâu dài. Kiểm tra `/healthz` và luồng đăng ký/xác minh email sau triển khai. Đặt lịch `maintenance`, sao lưu volume PostgreSQL và caddy_data. Không dùng lệnh `down -v` trên production. Chưa có VPS/tên miền được cung cấp nên cấu hình này chưa được triển khai ra Internet.

## Trạng thái kiểm chứng trong cloud

17 kiểm thử tích hợp/Chromium/mã hóa đã qua và migration đã được thử trên database mới trước lượt cài sạch. `npm audit` hiện không báo lỗ hổng đã biết. Lượt cài sạch sau đó phát hiện Prisma CLI cần tải schema engine từ `binaries.prisma.sh`, hiện bị proxy trả HTTP 403. Docker build cũng dừng ở bước này. Không tắt kiểm tra checksum hoặc TLS. Cần lưu quyền truy cập tên miền này trong cài đặt cloud rồi chạy lại script cài đặt, `npm test` và Docker build; không coi bản hiện tại là đã sẵn sàng production. Cổng ứng dụng theo yêu cầu là 8080. Chưa có địa chỉ VPS/tên miền hoặc SMTP production để triển khai thật.
