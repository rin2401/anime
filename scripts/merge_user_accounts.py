"""Gộp data lịch sử xem + yêu thích của 2 account Firebase Auth thành 1.

Ngữ cảnh: sign-in Google qua webview/IAB có lúc trả về account KHÔNG có email
(tài khoản công ty/Workspace bị hạn chế chia sẻ email) — Firebase không khớp
được email nên tạo account mới rác, làm tách history/favorites của cùng một
người ra 2 uid. Script chép data từ uid nguồn sang uid đích (entry cùng
itemKey giữ bản có ts mới hơn), rồi xoá account nguồn.

Chạy từ scripts/ (cần r3fire.json):

    uv run python merge_user_accounts.py <src_uid> <dst_uid> --dry-run  # xem kế hoạch
    uv run python merge_user_accounts.py <src_uid> <dst_uid>            # chỉ gộp data
    uv run python merge_user_accounts.py <src_uid> <dst_uid> --delete   # gộp + xoá account nguồn
"""
import argparse
import sys

import firebase_admin
from firebase_admin import auth as fb_auth
from firebase_admin import credentials, db

STORES = ['history', 'favorites']


def node_dict(ref):
    """Đọc node về dict; node key số liên tiếp RTDB trả về list → enumerate."""
    val = ref.get()
    if isinstance(val, list):
        return {str(i): v for i, v in enumerate(val)}
    return val or {}


def newer(src, dst):
    """Entry cùng itemKey: giữ bản ts mới hơn (trùng ts thì giữ bản đích)."""
    if not dst:
        return src
    if not src:
        return None
    return src if (src.get('ts') or 0) > (dst.get('ts') or 0) else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src_uid', help='account nguồn (dữ liệu sẽ được chuyển đi)')
    ap.add_argument('dst_uid', help='account đích (account chính có email)')
    ap.add_argument('--delete', action='store_true', help='xoá account nguồn khỏi Firebase Auth')
    ap.add_argument('--dry-run', action='store_true', help='chỉ in kế hoạch, không ghi')
    args = ap.parse_args()

    cred = credentials.Certificate('r3fire.json')
    firebase_admin.initialize_app(cred, {'databaseURL': 'https://r3fire.firebaseio.com'})

    src_user = fb_auth.get_user(args.src_uid)
    dst_user = fb_auth.get_user(args.dst_uid)
    print(f"nguồn: {args.src_uid} email={src_user.email!r} name={src_user.display_name!r}")
    print(f"đích  : {args.dst_uid} email={dst_user.email!r} name={dst_user.display_name!r}")
    if src_user.email and dst_user.email and src_user.email == dst_user.email:
        sys.exit('! 2 account trùng email thật — không cần gộp tay, xem lại giả định')

    users = db.reference('users')
    src_root, dst_root = users.child(args.src_uid), users.child(args.dst_uid)

    total = 0
    for store in STORES:
        src = node_dict(src_root.child(store))
        dst = node_dict(dst_root.child(store))
        writes = {k: v for k, v in src.items() if v and newer(v, dst.get(k))}
        if not writes:
            print(f"  {store}: không có gì để gộp")
            continue
        print(f"  {store}: gộp {len(writes)} entry -> đích")
        for k, v in sorted(writes.items()):
            ts = v.get('ts')
            print(f"    {k}: {v.get('title')!r} ep={v.get('ep')} ts={ts}")
        total += len(writes)
        if not args.dry_run:
            # Ghi từng entry con riêng — update đa path RTDB ghi đè cả node cha
            for k, v in writes.items():
                dst_root.child(store).child(k).set(v)

    if args.delete:
        leftovers = node_dict(src_root)
        if not args.dry_run and total:
            pass
        if leftovers and not args.dry_run and not total:
            print(f"  note: node users/{args.src_uid} còn dữ liệu lạ: {list(leftovers)}")
        if not args.dry_run:
            src_root.delete()
            fb_auth.delete_user(args.src_uid)
            print(f"  đã xoá account nguồn + node users/{args.src_uid}")

    if args.dry_run:
        print(f"(dry-run) sẽ gộp {total} entry{' + xoá account nguồn' if args.delete else ''}")


if __name__ == '__main__':
    main()
