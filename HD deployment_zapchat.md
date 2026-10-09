# HƯỚNG DẪN ĐẨY CODE LÊN GITHUB VÀ CẬP NHẬT LÊN HOST (VPS / HESTIACP)

Tài liệu hướng dẫn quy trình đồng bộ mã nguồn cho ứng dụng **ZapChat v3.1** từ máy trạm (Local) lên **GitHub** và tải về server **HestiaCP**.

---

## 📌 BƯỚC 1: Đẩy mã nguồn từ Máy Trạm (Local) lên GitHub

Mở **Terminal / Command Prompt / VS Code Terminal** tại thư mục dự án trên máy tính cá nhân và chạy lần lượt các lệnh sau:

```cmd
# 1. Thêm tất cả các file thay đổi vào Git
git add .

# 2. Tạo commit ghi nhận thay đổi
git commit -m "Cập nhật mã nguồn ZapChat"

# 3. Đẩy code lên nhánh main của GitHub
git push origin main
```

> **Lưu ý xử lý lỗi khi Push:**  
> Nếu gặp thông báo lỗi `[rejected] main -> main (fetch first)`, bạn có thể ép ghi đè bản mã nguồn từ máy trạm lên GitHub bằng lệnh:
> ```cmd
> git push origin main --force
> ```

---

## 📌 BƯỚC 2: Cập nhật mã nguồn mới về Host (VPS HestiaCP)

Mở cửa sổ **Terminal SSH** của server và thực hiện các bước sau:

### 1. Truy cập thư mục ứng dụng trên Host:
```bash
cd /home/hungdt245/web/chat.tinhoc247.online/public_html
```

### 2. Đồng bộ mã nguồn mới nhất từ GitHub:
```bash
# Ép đồng bộ sạch sẽ 100% từ GitHub (Khuyên dùng để tránh lỗi xung đột file/database)
git fetch origin main && git reset --hard origin/main
```

### 3. Khởi động lại tiến trình Node.js:
*(Chỉ cần thiết khi bạn có chỉnh sửa các tệp backend như `server.js` hoặc `email.config.js`)*

```bash
# Nếu ứng dụng quản lý bằng PM2:
pm2 restart zapchat

# Hoặc nếu chạy trực tiếp bằng Node:
fuser -k 2000/tcp && node server.js
```

---

## 🚀 BƯỚC 3: Cập nhật tự động 1-Click trên Server (Tùy chọn)

Để tiết kiệm thời gian, bạn có thể tạo tệp kịch bản `deploy.sh` ngay trên Host:

1. **Tạo tệp `deploy.sh`:**
   ```bash
   nano /home/hungdt245/web/chat.tinhoc247.online/public_html/deploy.sh
   ```

2. **Dán nội dung sau vào tệp:**
   ```bash
   #!/bin/bash
   echo "🚀 Đang tải code mới nhất từ GitHub..."
   git fetch origin main
   git reset --hard origin/main

   echo "🔄 Khởi động lại ứng dụng ZapChat..."
   pm2 restart zapchat

   echo "✅ Cập nhật hoàn tất thành công!"
   ```

3. **Lưu tệp và cấp quyền thực thi:**
   ```bash
   chmod +x deploy.sh
   ```

4. **Sử dụng cho các lần sau:**  
   Sau khi `git push` ở máy tính cá nhân, trên terminal của server bạn chỉ cần gõ duy nhất lệnh:
   ```bash
   ./deploy.sh
   ```