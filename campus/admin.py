from django.contrib import admin

from .models import Building, Lesson, Professor, Reservation, Room, StudentTimetable


@admin.register(Reservation)
class ReservationAdmin(admin.ModelAdmin):
    list_display = ['room', 'date', 'period', 'user', 'created_at']
    list_filter = ['date', 'room__building']


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ['building', 'number']
    list_filter = ['building']


@admin.register(Professor)
class ProfessorAdmin(admin.ModelAdmin):
    list_display = ['name', 'department', 'building', 'room', 'available']
    list_editable = ['available']
    list_filter = ['department']


admin.site.register(Building)
admin.site.register(Lesson)
admin.site.register(StudentTimetable)
