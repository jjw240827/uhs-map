from django.contrib import admin
from django.urls import path

from campus.api import api
from campus.views import index

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', api.urls),
    path('', index),
]
