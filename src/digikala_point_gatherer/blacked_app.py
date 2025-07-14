from flask import Flask
import requests, time, os
import pickle
import os
from bs4 import BeautifulSoup
from fake_useragent import UserAgent


app = Flask(__name__)

expire_time = 150

catch_db = {"phone": {"req": requests.Session(), "crtime": time.time()}}

phone_list = {}

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
        "mission_id": 1,
    }

    response = req.post(
        "https://api.digikala.com/v1/digiclub/dynamic-daily-mission/",
        json=json_data,
    )
    # print(response.text)
    return response.text


def send_otpcode(phnumber):
    req = requests.Session()
    req.headers = {
        "User-Agent": ua.random,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        # 'Accept-Encoding': 'gzip, deflate, br, zstd',
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Priority": "u=0, i",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
    }

    res = req.get("https://www.digikala.com/users/login/")
    json_data = {
        "username": phnumber,
        "otp_call": False,
        "hash": None,
    }

    response = req.post(
        "https://api.digikala.com/v1/user/authenticate/", json=json_data
    )
    # print(response.text)
    return response.text, req


def authonticate_phonenumber(phnumber, code, req):
    json_data = {
        "type": "otp",
        "username": phnumber,
        "code": code,
    }

    response = req.post("https://api.digikala.com/v1/user/login/otp/", json=json_data)
    return response.text, req


def expired(phone):
    global catch_db
    if catch_db[phone]["crtime"] + expire_time <= time.time():
        return True
    else:
        del catch_db[phone]
        return False


def add_catch(phone, req):
    global catch_db
    catch_db[phone] = {"req": req, "crtime": time.time()}


for i in os.listdir():
    if ".session" in i:
        phone_list[i.replace(".session", "")] = load_session(i.replace(".session", ""))


@app.route("/dailypoint/<phone>")
def dailypoint(phone):
    global phone_list
    if phone not in phone_list:
        return "no phone added"

    req = phone_list[phone]
    return get_daily_point(req)


@app.route("/init/<phone>")
def initphone(phone):
    global catch_db
    if phone in phone_list:
        return "phonenumber already exist"
    if expired(phone):
        return "redo the initing. expire time passed"
    if phone in catch_db:
        return "otp already sent"
    resault, req = send_otpcode(phone)
    add_catch(phone, req)
    return resault


@app.route("/auth/<string:phone>/<string:code>")
def auth_otp_code(phone, code):
    global catch_db, phone_list
    if phone in phone_list:
        return "phonenumber already exist"
    if expired(phone):
        return "redo the initing. expire time passed"
    resault, req = authonticate_phonenumber(phone, code, catch_db[phone]["req"])
    save_session(phone, req)
    phone_list[phone] = req
    return resault


def main():
    app.run()


if __name__ == "__main__":
    main()
