-- Seed UAE businesses for autocomplete
-- Categories: dental, hotel, restaurant, fitness, legal, real_estate, medical, ecommerce

INSERT OR IGNORE INTO businesses (name, domain, city, country, category, address) VALUES
-- Dental
('Versailles Dental Clinic', 'versaillesdental.ae', 'Dubai', 'UAE', 'dental', 'Jumeirah Beach Road, Dubai'),
('German Dental Clinic', 'germandental.ae', 'Dubai', 'UAE', 'dental', 'Business Bay, Dubai'),
('Dubai Dental Clinic', 'dubaidentalclinic.com', 'Dubai', 'UAE', 'dental', 'Deira, Dubai'),
('Dr. Nicolas & Asp', 'drnicolasandasp.com', 'Dubai', 'UAE', 'dental', 'DIFC, Dubai'),
('Dental Studio', 'dentalstudio.ae', 'Dubai', 'UAE', 'dental', 'JLT, Dubai'),
('Aster Dental Centre', 'asterdmhealthcare.com', 'Dubai', 'UAE', 'dental', 'Multiple Locations, Dubai'),
('BriteDent', 'bridentdubai.com', 'Dubai', 'UAE', 'dental', 'Marina, Dubai'),
('Apex Medical & Dental Center', 'apexdubai.com', 'Dubai', 'UAE', 'dental', 'Jumeirah, Dubai'),
('Hasan Medical Center', 'hasanmedical.com', 'Abu Dhabi', 'UAE', 'dental', 'Abu Dhabi'),
('Mediclinic Dental', 'mediclinic.ae', 'Dubai', 'UAE', 'dental', 'Multiple Locations'),

-- Hotels
('Burj Al Arab', 'jumeirah.com', 'Dubai', 'UAE', 'hotel', 'Jumeirah Beach Road, Dubai'),
('Atlantis The Palm', 'atlantis.com', 'Dubai', 'UAE', 'hotel', 'Palm Jumeirah, Dubai'),
('Address Downtown Dubai', 'addresshotels.com', 'Dubai', 'UAE', 'hotel', 'Downtown Dubai'),
('Four Seasons Resort Dubai', 'fourseasons.com', 'Dubai', 'UAE', 'hotel', 'Jumeirah Beach, Dubai'),
('Waldorf Astoria Dubai', 'waldorfastoria.com', 'Dubai', 'UAE', 'hotel', 'DIFC, Dubai'),
('Ritz Carlton Dubai', 'ritzcarlton.com', 'Dubai', 'UAE', 'hotel', 'JBR, Dubai'),
('Sofitel Dubai Downtown', 'sofitel.com', 'Dubai', 'UAE', 'hotel', 'Downtown Dubai'),
('Hyatt Regency Dubai', 'hyatt.com', 'Dubai', 'UAE', 'hotel', 'Deira, Dubai'),
('Rotana Hotels UAE', 'rotana.com', 'Abu Dhabi', 'UAE', 'hotel', 'Multiple Locations'),
('Armani Hotel Dubai', 'armanihotels.com', 'Dubai', 'UAE', 'hotel', 'Burj Khalifa, Dubai'),

-- Restaurants
('Nobu Dubai', 'nobudubai.com', 'Dubai', 'UAE', 'restaurant', 'Atlantis, Dubai'),
('Zuma Dubai', 'zumarestaurant.com', 'Dubai', 'UAE', 'restaurant', 'DIFC, Dubai'),
('La Petite Maison', 'lpmdubai.ae', 'Dubai', 'UAE', 'restaurant', 'DIFC, Dubai'),
('Pierchic', 'jumeirah.com', 'Dubai', 'UAE', 'restaurant', 'Al Qasr, Dubai'),
('Coya Dubai', 'coyadubai.com', 'Dubai', 'UAE', 'restaurant', 'Four Seasons, Dubai'),
('Comptoir 102', 'comptoir102.com', 'Dubai', 'UAE', 'restaurant', 'Jumeirah Beach Road, Dubai'),
('Arabian Tea House', 'arabianteahouse.ae', 'Dubai', 'UAE', 'restaurant', 'Al Fahidi, Dubai'),
('Al Fanar Restaurant', 'alfanarrestaurant.com', 'Dubai', 'UAE', 'restaurant', 'Festival City, Dubai'),
('Ravi Restaurant', 'ravirestaurant.ae', 'Dubai', 'UAE', 'restaurant', 'Satwa, Dubai'),
('Shakespeare and Co', 'shakespeare-and-co.com', 'Dubai', 'UAE', 'restaurant', 'Multiple Locations'),

-- Fitness / Gyms
('Fitness First UAE', 'fitnessfirst.ae', 'Dubai', 'UAE', 'fitness', 'Multiple Locations, Dubai'),
('Gold''s Gym UAE', 'goldsgym.ae', 'Dubai', 'UAE', 'fitness', 'Multiple Locations, Dubai'),
('Warehouse Gym', 'warehousegym.ae', 'Dubai', 'UAE', 'fitness', 'Business Bay, Dubai'),
('GymNation', 'gymnation.com', 'Dubai', 'UAE', 'fitness', 'Multiple Locations, Dubai'),
('Ignite Fitness', 'ignitefitness.ae', 'Dubai', 'UAE', 'fitness', 'JLT, Dubai'),
('CrossFit UAE', 'crossfituae.com', 'Dubai', 'UAE', 'fitness', 'Multiple Locations'),
('Barry''s Bootcamp Dubai', 'barrys.com', 'Dubai', 'UAE', 'fitness', 'Downtown Dubai'),
('F45 Training Dubai', 'f45training.com', 'Dubai', 'UAE', 'fitness', 'Multiple Locations'),
('Caballus Riding Centre', 'caballusriding.com', 'Dubai', 'UAE', 'fitness', 'Dubai'),
('1Rebel Dubai', '1rebel.ae', 'Dubai', 'UAE', 'fitness', 'DIFC, Dubai'),

-- Legal
('Al Tamimi & Company', 'tamimi.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('Clyde & Co UAE', 'clydeco.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('BSA Ahmad Bin Hezeem', 'bsame.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('Hadef & Partners', 'hadefpartners.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('Charles Russell Speechlys', 'charlesrussellspeechlys.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('Pinsent Masons UAE', 'pinsentmasons.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),
('Dentons UAE', 'dentons.com', 'Dubai', 'UAE', 'legal', 'DIFC, Dubai'),

-- Real Estate
('Bayut', 'bayut.com', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('Property Finder', 'propertyfinder.ae', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('Emaar Properties', 'emaar.com', 'Dubai', 'UAE', 'real_estate', 'Downtown Dubai'),
('Damac Properties', 'damacproperties.com', 'Dubai', 'UAE', 'real_estate', 'Business Bay, Dubai'),
('Nakheel', 'nakheel.com', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('Better Homes UAE', 'bhomes.com', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('LuxuryProperty.com', 'luxuryproperty.com', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('Allsopp & Allsopp', 'allsoppandallsopp.com', 'Dubai', 'UAE', 'real_estate', 'Dubai'),
('CBRE UAE', 'cbre.ae', 'Dubai', 'UAE', 'real_estate', 'DIFC, Dubai'),
('Driven Properties', 'drivenproperties.ae', 'Dubai', 'UAE', 'real_estate', 'Dubai'),

-- Medical / Clinics
('Aster DM Healthcare', 'asterdmhealthcare.com', 'Dubai', 'UAE', 'medical', 'Multiple Locations'),
('Mediclinic UAE', 'mediclinic.ae', 'Dubai', 'UAE', 'medical', 'Multiple Locations'),
('Cleveland Clinic Abu Dhabi', 'clevelandclinicabudhabi.ae', 'Abu Dhabi', 'UAE', 'medical', 'Abu Dhabi'),
('American Hospital Dubai', 'ahdubai.com', 'Dubai', 'UAE', 'medical', 'Oud Metha, Dubai'),
('Saudi German Hospital Dubai', 'sghgroup.net', 'Dubai', 'UAE', 'medical', 'Dubai'),
('Valiant Clinic', 'valiantclinic.com', 'Dubai', 'UAE', 'medical', 'Business Bay, Dubai'),
('Emirates Hospital', 'emirateshospital.ae', 'Dubai', 'UAE', 'medical', 'Jumeirah, Dubai'),
('NMC Healthcare', 'nmc.ae', 'Abu Dhabi', 'UAE', 'medical', 'Abu Dhabi'),
('Prime Medical Center', 'primemedical.ae', 'Dubai', 'UAE', 'medical', 'Multiple Locations'),
('Zulekha Hospital', 'zulekhahospitals.com', 'Dubai', 'UAE', 'medical', 'Dubai'),

-- E-commerce / Tech
('noon.com', 'noon.com', 'Dubai', 'UAE', 'ecommerce', 'Dubai'),
('Careem', 'careem.com', 'Dubai', 'UAE', 'tech', 'DIFC, Dubai'),
('dubizzle', 'dubizzle.com', 'Dubai', 'UAE', 'classifieds', 'Dubai'),
('Deliveroo UAE', 'deliveroo.ae', 'Dubai', 'UAE', 'food_delivery', 'Dubai'),
('Talabat', 'talabat.com', 'Dubai', 'UAE', 'food_delivery', 'Dubai'),

-- Retail / Lifestyle
('Kinokuniya Dubai', 'kinokuniya.com', 'Dubai', 'UAE', 'retail', 'Dubai Mall'),
('Faces Beauty', 'facesbeauty.com', 'Dubai', 'UAE', 'beauty', 'Multiple Locations'),
('Chalhoub Group', 'chalhoubgroup.com', 'Dubai', 'UAE', 'retail', 'Dubai'),
('Etihad Airways', 'etihad.com', 'Abu Dhabi', 'UAE', 'airline', 'Abu Dhabi'),
('Emirates Airlines', 'emirates.com', 'Dubai', 'UAE', 'airline', 'Dubai'),
('Dubai Tourism', 'visitdubai.com', 'Dubai', 'UAE', 'tourism', 'Dubai'),
('Etisalat', 'etisalat.ae', 'Abu Dhabi', 'UAE', 'telecom', 'Abu Dhabi'),
('du Telecom', 'du.ae', 'Dubai', 'UAE', 'telecom', 'Dubai'),
('ADNOC', 'adnoc.ae', 'Abu Dhabi', 'UAE', 'energy', 'Abu Dhabi'),
('DEWA', 'dewa.gov.ae', 'Dubai', 'UAE', 'utility', 'Dubai');
