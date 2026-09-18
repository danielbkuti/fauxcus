from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import CustomUser, PendingSignup, RateLimitAttempt


class CustomUserAdmin(UserAdmin):
    model = CustomUser
    list_display = ('username', 'email', 'first_name', 'last_name', 'is_staff')


class PendingSignupAdmin(admin.ModelAdmin):
    list_display = ('email', 'email_verified', 'code', 'code_attempts', 'username', 'created_at')
    readonly_fields = ('token', 'code', 'code_sent_at', 'created_at')


class RateLimitAttemptAdmin(admin.ModelAdmin):
    list_display = ('scope', 'client_ip', 'count', 'expires_at')
    list_filter = ('scope',)
    # Read-only — a row here is only ever meaningful as ratelimit.py
    # itself wrote it; hand-editing one from the admin would just be
    # forging an attempt count.
    readonly_fields = ('scope', 'client_ip', 'count', 'expires_at')


admin.site.register(CustomUser, CustomUserAdmin)
admin.site.register(PendingSignup, PendingSignupAdmin)
admin.site.register(RateLimitAttempt, RateLimitAttemptAdmin)
