"""ENSO phase per season per year (NOAA CPC Oceanic Niño Index), ported from docs/extremes.js.

Each entry is [phase, ONI anomaly]; None = not yet known (current partial year).
Seasons: winterTail = Jan–Feb, spring = Mar–May, summer = Jun–Aug, fall = Sep–Nov, winterOnset = Dec.
"""

SEASONS = [  # key, label, start day-index, end day-index (of 366)
    ("winterTail", "Winter (Jan–Feb)", 0, 60),
    ("spring", "Spring (Mar–May)", 60, 152),
    ("summer", "Summer (Jun–Aug)", 152, 244),
    ("fall", "Fall (Sep–Nov)", 244, 335),
    ("winterOnset", "Winter (Dec)", 335, 366),
]

PHASE_LABELS = {"nino": "El Niño", "nina": "La Niña", "neutral": "Neutral", "pending": "Not yet known"}
PHASE_COLORS = {"nino": "#eb6834", "nina": "#1baf7a", "neutral": "#898781", "pending": "#d0d0d0"}

SEASON_PHASE_BY_YEAR = {
    1991: {"winterTail": ('neutral', 0.33), "spring": ('neutral', 0.31), "summer": ('nino', 0.67), "fall": ('nino', 0.87), "winterOnset": ('nino', 1.53)},
    1992: {"winterTail": ('nino', 1.67), "spring": ('nino', 1.28), "summer": ('neutral', 0.4), "fall": ('neutral', -0.22), "winterOnset": ('neutral', -0.13)},
    1993: {"winterTail": ('neutral', 0.2), "spring": ('neutral', 0.62), "summer": ('neutral', 0.38), "fall": ('neutral', 0.1), "winterOnset": ('neutral', 0.06)},
    1994: {"winterTail": ('neutral', 0.07), "spring": ('neutral', 0.3), "summer": ('neutral', 0.43), "fall": ('nino', 0.77), "winterOnset": ('nino', 1.09)},
    1995: {"winterTail": ('nino', 0.84), "spring": ('neutral', 0.32), "summer": ('neutral', -0.27), "fall": ('nina', -0.93), "winterOnset": ('nina', -0.98)},
    1996: {"winterTail": ('nina', -0.82), "spring": ('neutral', -0.43), "summer": ('neutral', -0.3), "fall": ('neutral', -0.4), "winterOnset": ('neutral', -0.49)},
    1997: {"winterTail": ('neutral', -0.43), "spring": ('neutral', 0.31), "summer": ('nino', 1.57), "fall": ('nino', 2.29), "winterOnset": ('nino', 2.39)},
    1998: {"winterTail": ('nino', 2.08), "spring": ('nino', 0.96), "summer": ('nina', -0.68), "fall": ('nina', -1.38), "winterOnset": ('nina', -1.57)},
    1999: {"winterTail": ('nina', -1.43), "spring": ('nina', -1.02), "summer": ('nina', -1.08), "fall": ('nina', -1.29), "winterOnset": ('nina', -1.65)},
    2000: {"winterTail": ('nina', -1.53), "spring": ('nina', -0.86), "summer": ('nina', -0.57), "fall": ('nina', -0.64), "winterOnset": ('nina', -0.74)},
    2001: {"winterTail": ('nina', -0.6), "spring": ('neutral', -0.34), "summer": ('neutral', -0.11), "fall": ('neutral', -0.28), "winterOnset": ('neutral', -0.31)},
    2002: {"winterTail": ('neutral', -0.06), "spring": ('neutral', 0.24), "summer": ('nino', 0.77), "fall": ('nino', 1.18), "winterOnset": ('nino', 1.14)},
    2003: {"winterTail": ('nino', 0.78), "spring": ('neutral', 0.03), "summer": ('neutral', 0.04), "fall": ('neutral', 0.3), "winterOnset": ('neutral', 0.35)},
    2004: {"winterTail": ('neutral', 0.34), "spring": ('neutral', 0.19), "summer": ('neutral', 0.46), "fall": ('nino', 0.68), "winterOnset": ('nino', 0.69)},
    2005: {"winterTail": ('nino', 0.61), "spring": ('neutral', 0.39), "summer": ('neutral', -0.03), "fall": ('neutral', -0.32), "winterOnset": ('nina', -0.84)},
    2006: {"winterTail": ('nina', -0.81), "spring": ('neutral', -0.36), "summer": ('neutral', 0.12), "fall": ('nino', 0.75), "winterOnset": ('nino', 0.94)},
    2007: {"winterTail": ('nino', 0.44), "spring": ('neutral', -0.27), "summer": ('nina', -0.61), "fall": ('nina', -1.3), "winterOnset": ('nina', -1.6)},
    2008: {"winterTail": ('nina', -1.58), "spring": ('nina', -1.05), "summer": ('neutral', -0.4), "fall": ('neutral', -0.38), "winterOnset": ('nina', -0.73)},
    2009: {"winterTail": ('nina', -0.82), "spring": ('neutral', -0.31), "summer": ('neutral', 0.44), "fall": ('nino', 1.03), "winterOnset": ('nino', 1.56)},
    2010: {"winterTail": ('nino', 1.36), "spring": ('neutral', 0.34), "summer": ('nina', -1.02), "fall": ('nina', -1.61), "winterOnset": ('nina', -1.54)},
    2011: {"winterTail": ('nina', -1.18), "spring": ('nina', -0.63), "summer": ('neutral', -0.46), "fall": ('nina', -0.92), "winterOnset": ('nina', -0.92)},
    2012: {"winterTail": ('nina', -0.65), "spring": ('neutral', -0.33), "summer": ('neutral', 0.26), "fall": ('neutral', 0.28), "winterOnset": ('neutral', -0.1)},
    2013: {"winterTail": ('neutral', -0.29), "spring": ('neutral', -0.22), "summer": ('neutral', -0.32), "fall": ('neutral', -0.15), "winterOnset": ('neutral', -0.15)},
    2014: {"winterTail": ('neutral', -0.3), "spring": ('neutral', 0.11), "summer": ('neutral', 0.15), "fall": ('nino', 0.51), "winterOnset": ('nino', 0.77)},
    2015: {"winterTail": ('nino', 0.65), "spring": ('nino', 0.83), "summer": ('nino', 1.58), "fall": ('nino', 2.44), "winterOnset": ('nino', 2.75)},
    2016: {"winterTail": ('nino', 2.46), "spring": ('nino', 1.08), "summer": ('neutral', -0.27), "fall": ('neutral', -0.61), "winterOnset": ('neutral', -0.45)},
    2017: {"winterTail": ('neutral', -0.1), "spring": ('neutral', 0.3), "summer": ('neutral', 0.17), "fall": ('nina', -0.57), "winterOnset": ('nina', -0.86)},
    2018: {"winterTail": ('nina', -0.74), "spring": ('neutral', -0.36), "summer": ('neutral', 0.16), "fall": ('nino', 0.77), "winterOnset": ('nino', 0.92)},
    2019: {"winterTail": ('nino', 0.88), "spring": ('nino', 0.75), "summer": ('neutral', 0.35), "fall": ('neutral', 0.4), "winterOnset": ('nino', 0.66)},
    2020: {"winterTail": ('nino', 0.64), "spring": ('neutral', 0.28), "summer": ('neutral', -0.37), "fall": ('nina', -1.06), "winterOnset": ('nina', -1.08)},
    2021: {"winterTail": ('nina', -0.85), "spring": ('nina', -0.55), "summer": ('neutral', -0.37), "fall": ('nina', -0.77), "winterOnset": ('nina', -0.87)},
    2022: {"winterTail": ('nina', -0.8), "spring": ('nina', -0.9), "summer": ('nina', -0.8), "fall": ('nina', -0.92), "winterOnset": ('nina', -0.71)},
    2023: {"winterTail": ('nina', -0.42), "spring": ('neutral', 0.27), "summer": ('nino', 1.11), "fall": ('nino', 1.81), "winterOnset": ('nino', 2.06)},
    2024: {"winterTail": ('nino', 1.77), "spring": ('nino', 0.86), "summer": ('neutral', 0.08), "fall": ('neutral', -0.23), "winterOnset": ('neutral', -0.42)},
    2025: {"winterTail": ('neutral', -0.34), "spring": ('neutral', -0.02), "summer": ('neutral', -0.15), "fall": ('neutral', -0.49), "winterOnset": ('neutral', -0.54)},
    2026: {"winterTail": ('neutral', -0.26), "spring": ('neutral', 0.54), "summer": None, "fall": None, "winterOnset": None},
}
