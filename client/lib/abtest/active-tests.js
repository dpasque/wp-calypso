/**
 * Note: this file is imported by `client` and `test/e2e` tests. `test/e2e` do not have the config
 * required to make aliased imports work (e.g. `import * from 'lib/'). As such, we must use relative
 * paths here (e.g. `import * from '../../lib/`)
 */

/**************************************************************************************************/
/* This library is deprecated! Please consider ExPlat for your next A/B experiment.               */
/* See /client/lib/explat/readme.md for more info!
/**************************************************************************************************/

export default {
	pageBuilderMVP: {
		datestamp: '20190419',
		variations: {
			control: 100,
			test: 0,
		},
		defaultVariation: 'control',
		allowExistingUsers: true,
	},
	conciergeUpsellDial: {
		//this test is used to dial down the upsell offer
		datestamp: '20200910',
		variations: {
			offer: 75,
			noOffer: 25,
		},
		defaultVariation: 'noOffer',
		allowExistingUsers: true,
	},
	userlessCheckout: {
		datestamp: '20210806',
		variations: {
			variantUserless: 50,
			control: 50,
		},
		defaultVariation: 'control',
		allowExistingUsers: false,
		countryCodeTargets: [ 'US', 'CA' ],
	},
	reskinSignupFlow: {
		datestamp: '20300928',
		variations: {
			reskinned: 50,
			control: 50,
		},
		defaultVariation: 'control',
		allowExistingUsers: false,
	},
	newUsersWithFreePlan: {
		datestamp: '20210107',
		variations: {
			newOnboarding: 0,
			control: 100,
		},
		localeTargets: 'any',
		localeExceptions: [ 'en', 'es' ],
		defaultVariation: 'control',
		allowExistingUsers: false,
	},
	// Change the ordering of featured Jetpack products:
	// least to most expensive (control) vs most to least expensive (test)
	jetpackReverseFeaturedProducts: {
		datestamp: '20210422',
		variations: {
			highToLow_test: 50,
			lowToHigh_control: 50,
		},
		localeTargets: 'any',
		defaultVariation: 'lowToHigh_control',
		allowExistingUsers: true,
	},
};
