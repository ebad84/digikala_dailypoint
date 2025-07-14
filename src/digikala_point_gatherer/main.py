import requests
import pickle
import os
from bs4 import BeautifulSoup
from fake_useragent import UserAgent

ua = UserAgent()

def load_session(name) -> requests.Session:
    """Load a session from a file using the given numeric name."""
    filename = f"{name}.session"
    if not os.path.exists(filename):
        raise FileNotFoundError(f"Session file '{filename}' not found.")
    with open(filename, "rb") as f:
        session = pickle.load(f)
    return session

def save_session(name, session: requests.Session) -> None:
    """Save the session to a file using the given numeric name."""
    filename = f"{name}.session"
    with open(filename, "wb") as f:
        pickle.dump(session, f)

def get_daily_point(req):
    json_data = {
        'mission_id': 1,
    }

    response = req.post(
        'https://api.digikala.com/v1/digiclub/dynamic-daily-mission/',
        json=json_data,
    )
    print(response.text)

def main(phnumber = None):
    if not phnumber:
        phnumber = input("> ")
    try:
        req = load_session(phnumber)
    except Exception as e:
        print(e)
        req = requests.Session()
        req.headers = {
            'User-Agent': ua.random,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            # 'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Priority': 'u=0, i',
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache',
        }

        res = req.get("https://www.digikala.com/users/login/")
        json_data = {
            'username': phnumber,
            'otp_call': False,
            'hash': None,
        }

        response = req.post('https://api.digikala.com/v1/user/authenticate/', json=json_data)
        print(response.text)

        code = input("> ")

        json_data = {
            'type': 'otp',
            'username': phnumber,
            'code': code,
        }

        response = req.post('https://api.digikala.com/v1/user/login/otp/', json=json_data)

    get_daily_point(req)
    save_session(phnumber, req)



if __name__ == "__main__":
    main()