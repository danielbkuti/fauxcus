from django.contrib import admin
from .models import Task, SubTask, TaskActivity, Notification, CalendarItem, Goal

# Register your models here.
admin.site.register(Task)
admin.site.register(SubTask)
admin.site.register(TaskActivity)
admin.site.register(Notification)
admin.site.register(CalendarItem)
admin.site.register(Goal)
