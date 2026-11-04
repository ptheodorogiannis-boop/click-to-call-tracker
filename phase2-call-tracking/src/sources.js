'use strict';
// Where a fixed (non-website) tracking number is published. A call to it takes this channel, so offline and
// Google Business Profile calls stop landing in "direct".
const FIXED_SOURCES = {
  google_business: 'Google Business Profile',
  print: 'Print',
  radio: 'Radio',
  tv: 'TV',
  outdoor: 'Outdoor',
  partner: 'Partner or directory',
  offline_other: 'Other offline'
};

const CHANNEL_LABELS = {
  google_ads: 'Google Ads', meta_ads: 'Meta Ads', microsoft_ads: 'Microsoft Ads', other_paid: 'Other paid',
  google_organic: 'Google search', meta_organic: 'Facebook and Instagram', referral: 'Referral', direct: 'Direct',
  ...FIXED_SOURCES
};

const channel = (c) => CHANNEL_LABELS[c || 'direct'] || c || 'Direct';

module.exports = { FIXED_SOURCES, CHANNEL_LABELS, channel };
