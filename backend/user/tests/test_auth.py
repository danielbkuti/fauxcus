import json

from django.test import TestCase
from django.contrib.auth import get_user_model


class AuthTestCase(TestCase):

    def test_user_defaults_inactive(self):
        """
        Newly created users should default to inactive.
        """
        user = get_user_model().objects.create_user(
            username="newuser",
            email="new@test.com",
            password="password123"
        )

        self.assertFalse(user.is_active)


class LoginApiRememberMeTestCase(TestCase):
    """
    Covers login_api's session-expiry handling — the "remember me"
    checkbox (see LoginForm.jsx). SESSION_EXPIRE_AT_BROWSER_CLOSE=True
    is the app-wide default (settings.py), so the interesting behavior
    to verify is that login_api explicitly overrides that per-session:
    session-only unless remember_me was actually checked.
    """

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="rememberme",
            email="rememberme@test.com",
            password="password123",
            is_active=True,
        )

    def _login(self, remember_me):
        return self.client.post(
            "/user/api/login/",
            data=json.dumps({
                "username": "rememberme",
                "password": "password123",
                "remember_me": remember_me,
            }),
            content_type="application/json",
        )

    def test_remember_me_checked_sets_persistent_expiry(self):
        response = self._login(True)
        self.assertEqual(response.status_code, 200)
        # get_expiry_age() > 0 means a real, multi-second lifetime was
        # set (SESSION_COOKIE_AGE) rather than session.set_expiry(0).
        self.assertGreater(self.client.session.get_expiry_age(), 0)
        self.assertFalse(self.client.session.get_expire_at_browser_close())

    def test_remember_me_unchecked_expires_at_browser_close(self):
        response = self._login(False)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.session.get_expire_at_browser_close())

    def test_remember_me_omitted_defaults_to_browser_close(self):
        """No remember_me key at all behaves the same as False."""
        response = self.client.post(
            "/user/api/login/",
            data=json.dumps({"username": "rememberme", "password": "password123"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(self.client.session.get_expire_at_browser_close())