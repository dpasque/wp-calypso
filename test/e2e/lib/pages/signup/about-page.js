/**
 * External dependencies
 */
import { By } from 'selenium-webdriver';

/**
 * Internal dependencies
 */
import * as driverHelper from '../../driver-helper.js';

import AsyncBaseContainer from '../../async-base-container';

export default class AboutPage extends AsyncBaseContainer {
	constructor( driver ) {
		super( driver, By.css( '.about__wrapper' ) );
	}

	async submitForm() {
		const submitSelector = By.css( '.about__submit-wrapper button.is-primary' );
		return await driverHelper.clickWhenClickable( this.driver, submitSelector );
	}

	async enterSiteDetails(
		siteTitle,
		siteTopic,
		{ showcase = false, share = false, sell = false, educate = false, promote = false } = {}
	) {
		// The suggestion overlay of #siteTopic can prevent the site goals from getting clicked.
		// To avoid that problem, we're going to input the site topic first.
		await driverHelper.setWhenSettable( this.driver, By.css( '#siteTopic' ), siteTopic );
		await driverHelper.setWhenSettable( this.driver, By.css( '#siteTitle' ), siteTitle );

		if ( showcase === true ) {
			await driverHelper.setCheckbox( this.driver, By.css( '#showcase' ) );
		}
		if ( share === true ) {
			await driverHelper.setCheckbox( this.driver, By.css( '#share' ) );
		}
		if ( sell === true ) {
			await driverHelper.setCheckbox( this.driver, By.css( '#sell' ) );
		}
		if ( educate === true ) {
			await driverHelper.setCheckbox( this.driver, By.css( '#educate' ) );
		}
		if ( promote === true ) {
			await driverHelper.setCheckbox( this.driver, By.css( '#promote' ) );
		}
	}
}
