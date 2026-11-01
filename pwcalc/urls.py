from django.urls import path
from django.views.generic import TemplateView

from pwcalc.views import effects_api

urlpatterns = [
    path("", TemplateView.as_view(template_name="index.html"), name="index"),
    path("api/effects/", effects_api, name="effects"),
]
