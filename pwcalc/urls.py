from django.urls import path
from django.views.decorators.clickjacking import xframe_options_sameorigin
from django.views.generic import TemplateView

from pwcalc.views import catalog_api, effects_api

urlpatterns = [
    path("", TemplateView.as_view(template_name="index.html"), name="index"),
    path("compare/", TemplateView.as_view(template_name="comparison.html"), name="comparison"),
    path("calculator/", xframe_options_sameorigin(TemplateView.as_view(
        template_name="index.html", extra_context={"embedded": True},
    )), name="embedded_calculator"),
    path("api/effects/", effects_api, name="effects"),
    path("api/catalog/", catalog_api, name="catalog"),
]
