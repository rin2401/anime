from datetime import datetime, timedelta, timezone

def unix_to_str(dt, tz_offset=7, fmt="%Y-%m-%d %H:%M:%S"):
    if not dt:
        return ''
    # dt is a unix timestamp (seconds)
    return datetime.fromtimestamp(dt, tz=timezone(timedelta(hours=tz_offset))).strftime(fmt)

def date_dict_to_str(date_dict):
    # date_dict: {'year': 2025, 'month': 4, 'day': 5}
    if not date_dict or not date_dict.get('year'):
        return ''
    year = date_dict.get('year')
    month = date_dict.get('month') or 1
    day = date_dict.get('day') or 1
    try:
        dt = datetime(year, month, day)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return f"{year}-{month:02d}-{day if day else '??'}"
