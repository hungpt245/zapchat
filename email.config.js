/**
 * email.config.js – Cấu hình email gửi OTP quên mật khẩu
 *
 * HƯỚNG DẪN:
 * 1. Mở file này, điền thông tin email của bạn vào bên dưới
 * 2. Nếu dùng Gmail: bật "Mật khẩu ứng dụng" tại:
 *    https://myaccount.google.com/apppasswords
 *    (Bảo mật → Xác minh 2 bước → Mật khẩu ứng dụng)
 * 3. Lưu file rồi chạy lại: node server.js
 */

module.exports = {
  // --- Thông tin SMTP ---
  host: 'smtp.gmail.com',
  port: 465,                     
  secure: true,                  

  // --- Tài khoản gửi email ---
  user: 'hungpt245@gmail.com',
  pass: 'ncmdcbdiaztlvphf',      // Mật khẩu ứng dụng

  // --- Tên hiển thị khi gửi ---
  fromName: 'ZapChat',

  // --- Chống treo giao diện web ---
  connectionTimeout: 10000,
  greetingTimeout: 5000,
  socketTimeout: 10000
};