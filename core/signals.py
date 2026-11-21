"""Signals: every new user gets a Profile and the default categories."""

from django.contrib.auth import get_user_model
from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import DEFAULT_CATEGORIES, Category, Profile, Transfer

User = get_user_model()


def seed_default_categories(user):
    """Create the default category set for ``user`` (idempotent)."""
    parents = {}
    for name, kind, parent_name in DEFAULT_CATEGORIES:
        parent = parents.get(parent_name) if parent_name else None
        category, _ = Category.objects.get_or_create(
            user=user,
            name=name,
            type=kind,
            defaults={"parent": parent, "is_default": True},
        )
        if parent_name is None:
            parents[name] = category
    return Category.objects.filter(user=user, is_default=True).count()


@receiver(post_save, sender=User)
def create_user_defaults(sender, instance, created, **kwargs):
    if not created:
        return
    Profile.objects.get_or_create(user=instance)
    seed_default_categories(instance)


@receiver(post_save, sender=Transfer)
def sync_transfer_legs(sender, instance, **kwargs):
    """Keep the transfer's two ledger legs in sync on every save."""
    instance.sync_legs()
