-- ============================================================
-- WorkSpot: Seed Data
-- ============================================================

INSERT INTO spots (
  name, slug, type, address, city, neighborhood, lat, lng,
  photos, hours, work_score, late_night_score, wifi_score, outlet_score,
  noise_level, seating_comfort, has_wifi, has_outlets, laptop_friendly,
  has_bathroom, has_food, has_drinks, vibe_tags, notes, status
) VALUES

-- ── New York City ─────────────────────────────────────────────

('Joe Coffee Waverly',
 'joe-coffee-waverly-nyc',
 'coffee_shop',
 '141 Waverly Pl, New York, NY 10014',
 'New York City', 'Greenwich Village', 40.731228, -74.000608,
 '[{"url":"https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=800","caption":"Interior"},{"url":"https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=800","caption":"Counter"}]'::jsonb,
 '{"monday":{"open":"07:00","close":"20:00"},"tuesday":{"open":"07:00","close":"20:00"},"wednesday":{"open":"07:00","close":"20:00"},"thursday":{"open":"07:00","close":"20:00"},"friday":{"open":"07:00","close":"20:00"},"saturday":{"open":"08:00","close":"20:00"},"sunday":{"open":"08:00","close":"19:00"}}'::jsonb,
 8.2, 5.0, 8.5, 7.0, 'moderate', 'good', true, true, true, true, true, true,
 ARRAY['cozy','specialty coffee','laptop ok','no time limit'],
 'Great espresso. Good natural light. Fills up fast on weekends.',
 'approved'),

('Bushwick Grind',
 'bushwick-grind-nyc',
 'coffee_shop',
 '230 Wyckoff Ave, Brooklyn, NY 11237',
 'New York City', 'Bushwick', 40.703512, -73.923801,
 '[{"url":"https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800","caption":"Bar area"}]'::jsonb,
 '{"monday":{"open":"07:00","close":"23:00"},"tuesday":{"open":"07:00","close":"23:00"},"wednesday":{"open":"07:00","close":"23:00"},"thursday":{"open":"07:00","close":"00:00"},"friday":{"open":"07:00","close":"02:00"},"saturday":{"open":"09:00","close":"02:00"},"sunday":{"open":"09:00","close":"22:00"}}'::jsonb,
 7.8, 9.0, 7.5, 8.5, 'moderate', 'good', true, true, true, true, true, true,
 ARRAY['industrial','late night','loud weekends','outlets everywhere'],
 'Stays open late Thu–Sat. Beer + coffee. Good outlet situation.',
 'approved'),

('The Late Lobby',
 'the-late-lobby-nyc',
 'hotel_lobby',
 '485 7th Ave, New York, NY 10018',
 'New York City', 'Midtown', 40.750832, -73.993401,
 '[{"url":"https://images.unsplash.com/photo-1564501049412-61c2a3083791?w=800","caption":"Lobby"},{"url":"https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800","caption":"Seating area"}]'::jsonb,
 '{"monday":{"open":"00:00","close":"23:59"},"tuesday":{"open":"00:00","close":"23:59"},"wednesday":{"open":"00:00","close":"23:59"},"thursday":{"open":"00:00","close":"23:59"},"friday":{"open":"00:00","close":"23:59"},"saturday":{"open":"00:00","close":"23:59"},"sunday":{"open":"00:00","close":"23:59"}}'::jsonb,
 6.5, 9.8, 8.0, 9.0, 'quiet', 'excellent', true, true, true, true, false, true,
 ARRAY['24hr','hotel lobby','quiet','business traveler','power everywhere'],
 '24-hour hotel lobby. AC everywhere. Staff never bothers you. Bring your own snacks.',
 'approved'),

('Veselka',
 'veselka-nyc',
 'diner',
 '144 2nd Ave, New York, NY 10003',
 'New York City', 'East Village', 40.728401, -73.986901,
 '[{"url":"https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=800","caption":"Dining room"}]'::jsonb,
 '{"monday":{"open":"00:00","close":"23:59"},"tuesday":{"open":"00:00","close":"23:59"},"wednesday":{"open":"00:00","close":"23:59"},"thursday":{"open":"00:00","close":"23:59"},"friday":{"open":"00:00","close":"23:59"},"saturday":{"open":"00:00","close":"23:59"},"sunday":{"open":"00:00","close":"23:59"}}'::jsonb,
 7.0, 9.5, 5.0, 6.0, 'moderate', 'good', true, true, true, true, true, true,
 ARRAY['24hr','Ukrainian diner','classic NYC','late night food','loud weekends'],
 'NYC institution. Open 24 hours. Wifi is spotty but the pierogi are worth it.',
 'approved'),

-- ── Los Angeles ───────────────────────────────────────────────

('Intelligentsia Silver Lake',
 'intelligentsia-silver-lake-la',
 'coffee_shop',
 '3922 W Sunset Blvd, Los Angeles, CA 90029',
 'Los Angeles', 'Silver Lake', 34.090301, -118.270401,
 '[{"url":"https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800","caption":"Espresso bar"},{"url":"https://images.unsplash.com/photo-1453614512568-c4024d13c247?w=800","caption":"Seating"}]'::jsonb,
 '{"monday":{"open":"06:00","close":"20:00"},"tuesday":{"open":"06:00","close":"20:00"},"wednesday":{"open":"06:00","close":"20:00"},"thursday":{"open":"06:00","close":"20:00"},"friday":{"open":"06:00","close":"20:00"},"saturday":{"open":"07:00","close":"20:00"},"sunday":{"open":"07:00","close":"20:00"}}'::jsonb,
 8.5, 4.0, 8.8, 7.5, 'quiet', 'good', true, true, true, true, false, true,
 ARRAY['specialty coffee','sunny','patio','influencer crowd'],
 'Beautiful light in the morning. Patio seating. Gets crowded but table turnover is fast.',
 'approved'),

('Night Owl Diner',
 'night-owl-diner-la',
 'diner',
 '5601 Hollywood Blvd, Los Angeles, CA 90028',
 'Los Angeles', 'Hollywood', 34.101801, -118.316401,
 '[{"url":"https://images.unsplash.com/photo-1567521464027-f127ff144326?w=800","caption":"Counter seats"}]'::jsonb,
 '{"monday":{"open":"06:00","close":"02:00"},"tuesday":{"open":"06:00","close":"02:00"},"wednesday":{"open":"06:00","close":"02:00"},"thursday":{"open":"06:00","close":"03:00"},"friday":{"open":"00:00","close":"23:59"},"saturday":{"open":"00:00","close":"23:59"},"sunday":{"open":"06:00","close":"02:00"}}'::jsonb,
 6.8, 9.2, 6.0, 7.0, 'moderate', 'fair', true, true, true, true, true, true,
 ARRAY['late night','diner','counter seating','wifi ok','24hr weekends'],
 'Classic diner energy late night. Wifi works. Counter outlets available.',
 'approved'),

-- ── Chicago ───────────────────────────────────────────────────

('Intelligentsia Wicker Park',
 'intelligentsia-wicker-park-chicago',
 'coffee_shop',
 '1850 W North Ave, Chicago, IL 60622',
 'Chicago', 'Wicker Park', 41.910201, -87.677801,
 '[{"url":"https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=800","caption":"Interior"}]'::jsonb,
 '{"monday":{"open":"06:30","close":"21:00"},"tuesday":{"open":"06:30","close":"21:00"},"wednesday":{"open":"06:30","close":"21:00"},"thursday":{"open":"06:30","close":"21:00"},"friday":{"open":"06:30","close":"21:00"},"saturday":{"open":"07:00","close":"21:00"},"sunday":{"open":"07:00","close":"20:00"}}'::jsonb,
 8.7, 5.5, 9.0, 8.0, 'quiet', 'excellent', true, true, true, true, false, true,
 ARRAY['specialty coffee','architect crowd','quiet','great wifi'],
 'Seriously good wifi. Beautiful buildout. Not a place to take calls.',
 'approved'),

('The Allis at Soho House',
 'the-allis-soho-house-chicago',
 'bar',
 '113 N Green St, Chicago, IL 60607',
 'Chicago', 'West Loop', 41.885601, -87.648401,
 '[{"url":"https://images.unsplash.com/photo-1470337458703-46ad1756a187?w=800","caption":"Bar"},{"url":"https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=800","caption":"Lounge"}]'::jsonb,
 '{"monday":{"open":"08:00","close":"23:00"},"tuesday":{"open":"08:00","close":"23:00"},"wednesday":{"open":"08:00","close":"00:00"},"thursday":{"open":"08:00","close":"00:00"},"friday":{"open":"08:00","close":"02:00"},"saturday":{"open":"09:00","close":"02:00"},"sunday":{"open":"09:00","close":"22:00"}}'::jsonb,
 7.5, 8.0, 7.5, 8.5, 'moderate', 'excellent', true, true, true, true, true, true,
 ARRAY['hotel bar','members club','upscale','late night','power outlets','good wifi'],
 'Members club but lobby/bar is semi-public. Excellent seating, great wifi.',
 'approved'),

-- ── San Francisco ─────────────────────────────────────────────

('Sightglass Coffee SoMa',
 'sightglass-soma-sf',
 'coffee_shop',
 '270 7th St, San Francisco, CA 94103',
 'San Francisco', 'SoMa', 37.779401, -122.408801,
 '[{"url":"https://images.unsplash.com/photo-1493857671505-72967e2e2760?w=800","caption":"Roastery"},{"url":"https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=800","caption":"Upper level"}]'::jsonb,
 '{"monday":{"open":"07:00","close":"17:00"},"tuesday":{"open":"07:00","close":"17:00"},"wednesday":{"open":"07:00","close":"17:00"},"thursday":{"open":"07:00","close":"17:00"},"friday":{"open":"07:00","close":"17:00"},"saturday":{"open":"08:00","close":"17:00"},"sunday":{"open":"08:00","close":"17:00"}}'::jsonb,
 9.0, 3.0, 9.2, 9.0, 'moderate', 'excellent', true, true, true, true, true, true,
 ARRAY['roastery','two floors','great outlets','tech crowd','closes early'],
 'Two-story roastery with tons of outlets and tables. Closes at 5pm though.',
 'approved'),

('Sightglass New Montgomery',
 'sightglass-new-montgomery-sf',
 'coffee_shop',
 '301 Howard St, San Francisco, CA 94105',
 'San Francisco', 'Financial District', 37.788801, -122.395701,
 '[{"url":"https://images.unsplash.com/photo-1498804103079-a6351b050096?w=800","caption":"Street view"}]'::jsonb,
 '{"monday":{"open":"06:30","close":"19:00"},"tuesday":{"open":"06:30","close":"19:00"},"wednesday":{"open":"06:30","close":"19:00"},"thursday":{"open":"06:30","close":"19:00"},"friday":{"open":"06:30","close":"19:00"},"saturday":{"open":"07:00","close":"17:00"},"sunday":null}'::jsonb,
 8.0, 3.5, 8.5, 8.0, 'quiet', 'good', true, true, true, true, true, true,
 ARRAY['financial district','quiet','no weekends','quick turnover'],
 'Dead quiet on weekdays. Good wifi. Closed Sundays.',
 'approved'),

-- ── Austin ────────────────────────────────────────────────────

('Epoch Coffee North Loop',
 'epoch-coffee-north-loop-austin',
 'coffee_shop',
 '221 W North Loop Blvd, Austin, TX 78751',
 'Austin', 'North Loop', 30.319801, -97.733601,
 '[{"url":"https://images.unsplash.com/photo-1463797221720-6b07e6426c24?w=800","caption":"Late night interior"}]'::jsonb,
 '{"monday":{"open":"00:00","close":"23:59"},"tuesday":{"open":"00:00","close":"23:59"},"wednesday":{"open":"00:00","close":"23:59"},"thursday":{"open":"00:00","close":"23:59"},"friday":{"open":"00:00","close":"23:59"},"saturday":{"open":"00:00","close":"23:59"},"sunday":{"open":"00:00","close":"23:59"}}'::jsonb,
 8.8, 9.9, 8.0, 9.5, 'moderate', 'good', true, true, true, true, true, true,
 ARRAY['24hr','Austin legend','laptop friendly','late night','outdoor patio'],
 'THE 24-hour coffee spot in Austin. Always busy but always open. Outlets at every table.',
 'approved'),

('Bennu Coffee 6th',
 'bennu-coffee-6th-austin',
 'coffee_shop',
 '1607 E 6th St, Austin, TX 78702',
 'Austin', 'East Austin', 30.260901, -97.720001,
 '[{"url":"https://images.unsplash.com/photo-1511920170033-f8396924c348?w=800","caption":"Outdoor area"}]'::jsonb,
 '{"monday":{"open":"00:00","close":"23:59"},"tuesday":{"open":"00:00","close":"23:59"},"wednesday":{"open":"00:00","close":"23:59"},"thursday":{"open":"00:00","close":"23:59"},"friday":{"open":"00:00","close":"23:59"},"saturday":{"open":"00:00","close":"23:59"},"sunday":{"open":"00:00","close":"23:59"}}'::jsonb,
 8.5, 9.9, 8.5, 8.5, 'moderate', 'good', true, true, true, true, true, true,
 ARRAY['24hr','east austin','dog friendly','outdoor seating','late night'],
 'Also 24 hours. East Austin vibe. Dog-friendly patio. Solid wifi.',
 'approved'),

-- ── Seattle ───────────────────────────────────────────────────

('Victrola Coffee Roasters',
 'victrola-coffee-capitol-hill-seattle',
 'coffee_shop',
 '310 E Pike St, Seattle, WA 98122',
 'Seattle', 'Capitol Hill', 47.614801, -122.326501,
 '[{"url":"https://images.unsplash.com/photo-1447933601403-0c6688de566e?w=800","caption":"Interior"},{"url":"https://images.unsplash.com/photo-1517231925375-bf2cb42917a5?w=800","caption":"Roaster"}]'::jsonb,
 '{"monday":{"open":"06:30","close":"19:00"},"tuesday":{"open":"06:30","close":"19:00"},"wednesday":{"open":"06:30","close":"19:00"},"thursday":{"open":"06:30","close":"19:00"},"friday":{"open":"06:30","close":"19:00"},"saturday":{"open":"07:00","close":"19:00"},"sunday":{"open":"07:00","close":"18:00"}}'::jsonb,
 8.5, 4.0, 8.0, 8.0, 'quiet', 'good', true, true, true, true, false, true,
 ARRAY['roastery','quiet','serious coffee','laptop crowd'],
 'Seattle staple. Great pour-overs. Calm atmosphere during weekday mornings.',
 'approved');


-- ── Seed a few approved reviews ──────────────────────────────

INSERT INTO reviews (spot_id, author_name, wifi_rating, outlet_rating, noise_rating, seating_rating, late_night_rating, comment, status)
SELECT id, 'Alex T.', 4, 4, 3, 4, 2, 'Solid daytime spot. Wifi is fast. Gets loud around noon.', 'approved'
FROM spots WHERE slug = 'joe-coffee-waverly-nyc';

INSERT INTO reviews (spot_id, author_name, wifi_rating, outlet_rating, noise_rating, seating_rating, late_night_rating, comment, status)
SELECT id, 'Sam K.', 5, 5, 2, 3, 5, 'Best 24hr spot I''ve found in NYC. Lobby is massive and quiet.', 'approved'
FROM spots WHERE slug = 'the-late-lobby-nyc';

INSERT INTO reviews (spot_id, author_name, wifi_rating, outlet_rating, noise_rating, seating_rating, late_night_rating, comment, status)
SELECT id, 'Jordan M.', 4, 5, 3, 4, 5, 'Austin gold standard for late night work. Never been turned away.', 'approved'
FROM spots WHERE slug = 'epoch-coffee-north-loop-austin';

INSERT INTO reviews (spot_id, author_name, wifi_rating, outlet_rating, noise_rating, seating_rating, late_night_rating, comment, status)
SELECT id, 'Riley P.', 5, 5, 4, 5, 2, 'Unreal space. Two floors of tables and outlets. Just close too early.', 'approved'
FROM spots WHERE slug = 'sightglass-soma-sf';
