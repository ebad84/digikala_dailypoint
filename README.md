

## Technologies Used

- **Language**: Python
- **Package Manager**: [Poetry](https://python-poetry.org/)

## Python Libraries

The following libraries were used in this project:

- [`beautifulsoup4`](https://pypi.org/project/beautifulsoup4/) - For parsing HTML and XML documents
- [`fake-useragent`](https://pypi.org/project/fake-useragent/) - To generate random user-agent headers
- [`flask`](https://pypi.org/project/Flask/) - For creating the web API/server
- [`requests`](https://pypi.org/project/requests/) - To make HTTP requests

## how to use?
برای اینکه این پروژه رو خودتون ران کنین، اول فورک کنینش
بعدش کلون کنینش با git clone
بعد requirements هاش رو نصب کنین با pip یا پکیج منیجر خودتون که برای من poetry هست
بعد فایل main.py رو اجرا کنین
.و شماره رو بدین و لاگین کنین
همه این کارا رو هم با api میتونین انجام بدین

```
~/init/<phone>

~/auth/<string:phone>/<string:code>
```

مرحله بعدی اجراشه. میتونین روی سیستم/سرور خودتون اجراش کنین با کامند flask run یا python app.py

همچنین میتونین با استفاده از لیارا، این پروژه رو به شکل دائمی ران داشته باشین

برای اینکه هر روز هم بتونین پوینت رو اوتومات بگیرین، از uptimerobot.com میتونین استفاده کنین

## a note for myself
git config --global alias.acpp '!f() { git add . && git commit -m "$1" && git push; }; f'
git acpp "your message"