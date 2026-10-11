"""Đặt mật khẩu cho một account Firebase Auth đang chỉ đăng nhập bằng Google.

Mục đích: cho phép đăng nhập bằng "email cá nhân + mật khẩu" vào ĐÚNG account
đã có (one account per email) trên những thiết bị mà popup Google không chạy
được (webview/IAB). Sau khi đặt, sign-in Google bằng cùng gmail sẽ tự link
vào account này (firebaseui hỏi mật khẩu account có sẵn).

Chạy từ scripts/ (cần r3fire.json):

    uv run python set_user_password.py <email> --dry-run            # xem kế hoạch
    uv run python set_user_password.py <email> --generate           # sinh mật khẩu ngẫu nhiên
    uv run python set_user_password.py <email> --password '...'     # tự đặt mật khẩu
"""
import argparse
import secrets
import string
import sys

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials

ALPHABET = string.ascii_letters + string.digits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('email')
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--generate', action='store_true', help='sinh mật khẩu ngẫu nhiên 16 ký tự')
    g.add_argument('--password', help='đặt mật khẩu cụ thể')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    firebase_admin.initialize_app(credentials.Certificate('r3fire.json'))
    user = fb_auth.get_user_by_email(args.email)
    provs = sorted(p.provider_id for p in user.provider_data)
    print(f"account: {args.email} uid={user.uid} providers={provs}")

    # provider đính trên account = các cách sign-in khả dụng
    if 'password' in provs:
        print('! account này ĐÃ có mật khẩu — chạy lại sẽ ĐỔI mật khẩu hiện tại')
    if 'google.com' not in provs:
        print('! email này chưa có provider Google — chỉ thêm mật khẩu')

    if args.generate:
        password = ''.join(secrets.choice(ALPHABET) for _ in range(16))
    else:
        password = args.password
    if len(password) < 6:
        sys.exit('! mật khẩu phải có tối thiểu 6 ký tự')

    if args.dry_run:
        print('(dry-run) sẽ đặt mật khẩu cho account trên; mật khẩu không được in ra')
        return
    fb_auth.update_user(user.uid, password=password)
    print('xong — account hiện hỗ trợ sign-in:', ', '.join(provs + ['password']))
    if args.generate:
        print(f'MẬT KHẨU (lưu lại, không hiện lần nữa): {password}')


if __name__ == '__main__':
    main()
