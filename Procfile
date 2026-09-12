release: flask --app app:create_app db upgrade heads && flask --app app:create_app create-admin
web: gunicorn --config gunicorn.conf.py "app:create_app()"
